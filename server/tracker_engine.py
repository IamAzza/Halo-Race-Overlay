from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import cv2
import numpy as np


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass
class TrackState:
    driver_id: int
    template: np.ndarray
    anchor_template: np.ndarray
    x: float
    y: float
    patch_w: int
    patch_h: int
    search_radius: int = 180
    confidence: float = 1.0
    status: str = "locked"
    vx: float = 0.0
    vy: float = 0.0
    lost_frames: int = 0
    hold_frames: int = 0
    reacquire_boost: int = 0


@dataclass
class TrackResult:
    driver_id: int
    x: float
    y: float
    confidence: float
    status: str


class MultiTrackerEngine:
    def __init__(self) -> None:
        self.tracks: Dict[int, TrackState] = {}
        self.prev_gray: Optional[np.ndarray] = None

    def reset(self) -> None:
        self.tracks.clear()
        self.prev_gray = None

    def remove(self, driver_id: int) -> None:
        self.tracks.pop(driver_id, None)

    def _extract_patch(
        self, gray: np.ndarray, center_x: float, center_y: float, w: int, h: int
    ) -> Optional[np.ndarray]:
        ih, iw = gray.shape[:2]
        x = int(round(center_x - w / 2))
        y = int(round(center_y - h / 2))

        if x < 0 or y < 0 or x + w > iw or y + h > ih:
            return None

        return gray[y:y + h, x:x + w].copy()

    def initialize_track(
        self,
        driver_id: int,
        frame_bgr: np.ndarray,
        x: float,
        y: float,
        patch_w: int = 34,
        patch_h: int = 34,
        search_radius: int = 190,
    ) -> bool:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        patch = self._extract_patch(gray, x, y, patch_w, patch_h)
        if patch is None:
            return False

        self.tracks[driver_id] = TrackState(
            driver_id=driver_id,
            template=patch.copy(),
            anchor_template=patch.copy(),
            x=x,
            y=y,
            patch_w=patch_w,
            patch_h=patch_h,
            search_radius=search_radius,
        )
        self.prev_gray = gray
        return True

    def update(self, frame_bgr: np.ndarray) -> list[TrackResult]:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        results: list[TrackResult] = []

        if self.prev_gray is None:
            self.prev_gray = gray
            for track in self.tracks.values():
                results.append(
                    TrackResult(
                        driver_id=track.driver_id,
                        x=track.x,
                        y=track.y,
                        confidence=track.confidence,
                        status=track.status,
                    )
                )
            return results

        motion = cv2.absdiff(gray, self.prev_gray)
        self.prev_gray = gray

        for track in self.tracks.values():
            result = self._update_single(gray, motion, track)
            results.append(result)

        return results

    def _update_single(
        self, gray: np.ndarray, motion: np.ndarray, track: TrackState
    ) -> TrackResult:
        ih, iw = gray.shape[:2]

        predicted_x = track.x + track.vx
        predicted_y = track.y + track.vy

        radius = int(clamp(track.search_radius + track.reacquire_boost, track.search_radius, 320))

        start_x = int(clamp(predicted_x - radius, 0, iw - track.patch_w))
        end_x = int(clamp(predicted_x + radius, 0, iw - track.patch_w))
        start_y = int(clamp(predicted_y - radius, 0, ih - track.patch_h))
        end_y = int(clamp(predicted_y + radius, 0, ih - track.patch_h))

        best_total = float("inf")
        best_live = float("inf")
        best_anchor = float("inf")
        best_motion = 0.0
        best_center_x = track.x
        best_center_y = track.y
        best_patch: Optional[np.ndarray] = None

        template_f = track.template.astype(np.float32)
        anchor_f = track.anchor_template.astype(np.float32)

        for y in range(start_y, end_y + 1, 3):
            for x in range(start_x, end_x + 1, 3):
                patch = gray[y:y + track.patch_h, x:x + track.patch_w]
                motion_patch = motion[y:y + track.patch_h, x:x + track.patch_w]

                if patch.shape != track.template.shape:
                    continue

                live_score = float(np.mean(np.abs(template_f - patch.astype(np.float32))))
                anchor_score = float(np.mean(np.abs(anchor_f - patch.astype(np.float32))))
                motion_strength = float(np.mean(motion_patch)) / 255.0
                center_x = x + track.patch_w / 2
                center_y = y + track.patch_h / 2
                dist_penalty = np.hypot(center_x - predicted_x, center_y - predicted_y) * 0.18
                motion_bonus = motion_strength * 12.0

                total = (live_score * 0.68 + anchor_score * 0.32 + dist_penalty) - motion_bonus

                if total < best_total:
                    best_total = total
                    best_live = live_score
                    best_anchor = anchor_score
                    best_motion = motion_strength
                    best_center_x = center_x
                    best_center_y = center_y
                    best_patch = patch.copy()

        raw_move = float(np.hypot(best_center_x - track.x, best_center_y - track.y))

        conf_total = 1.0 - clamp((best_total - 8.0) / 30.0, 0.0, 1.0)
        conf_live = 1.0 - clamp((best_live - 6.0) / 30.0, 0.0, 1.0)
        conf_anchor = 1.0 - clamp((best_anchor - 6.0) / 32.0, 0.0, 1.0)

        confidence = (
            conf_total * 0.46
            + conf_live * 0.32
            + conf_anchor * 0.12
            + min(0.10, best_motion * 0.18)
        )

        if raw_move > 45:
            confidence *= 0.8
        if raw_move > 70:
            confidence *= 0.6

        if raw_move > 60 and confidence < 0.55:
            best_center_x = track.x
            best_center_y = track.y
            confidence *= 0.72
        elif raw_move > 38 and confidence < 0.45 and best_motion < 0.12:
            best_center_x = track.x + (best_center_x - track.x) * 0.14
            best_center_y = track.y + (best_center_y - track.y) * 0.14
            confidence *= 0.86

        hold_mode = False
        if confidence < 0.42:
            if track.hold_frames < 28:
                hold_mode = True
                track.hold_frames += 1
        else:
            track.hold_frames = 0

        if hold_mode:
            track.reacquire_boost = int(clamp(track.reacquire_boost + 12, 0, 140))
        elif confidence >= 0.65:
            track.reacquire_boost = int(clamp(track.reacquire_boost - 10, 0, 140))

        effective_move = float(np.hypot(best_center_x - track.x, best_center_y - track.y))
        max_per_frame = 28 if confidence >= 0.72 else 18 if confidence >= 0.58 else 10

        target_x = best_center_x
        target_y = best_center_y

        if hold_mode:
            target_x = track.x
            target_y = track.y
        elif effective_move > max_per_frame:
            ratio = max_per_frame / effective_move
            target_x = track.x + (best_center_x - track.x) * ratio
            target_y = track.y + (best_center_y - track.y) * ratio

        alpha = 0.54 if confidence >= 0.74 else 0.28 if confidence >= 0.58 else 0.12

        prev_x = track.x
        prev_y = track.y

        if not hold_mode:
            track.x = track.x + (target_x - track.x) * alpha
            track.y = track.y + (target_y - track.y) * alpha

        track.vx = track.x - prev_x
        track.vy = track.y - prev_y
        track.confidence = float(confidence)

        if not hold_mode and confidence >= 0.62:
            track.status = "locked"
            track.lost_frames = 0
            if best_patch is not None:
                track.template = cv2.addWeighted(
                    track.template.astype(np.float32),
                    0.96,
                    best_patch.astype(np.float32),
                    0.04,
                    0,
                ).astype(np.uint8)
        elif hold_mode or confidence >= 0.20:
            track.status = "weak"
            track.lost_frames = 0
        else:
            track.lost_frames += 1
            track.status = "lost" if track.lost_frames >= 16 else "weak"

        return TrackResult(
            driver_id=track.driver_id,
            x=float(track.x),
            y=float(track.y),
            confidence=float(track.confidence),
            status=track.status,
        )