from __future__ import annotations

import base64

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from tracker_engine import MultiTrackerEngine


app = FastAPI()
engine = MultiTrackerEngine()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InitTrackRequest(BaseModel):
    driver_id: int
    x: float
    y: float
    frame_data_url: str
    patch_w: int = 24
    patch_h: int = 24
    search_radius: int = 150


class UpdateRequest(BaseModel):
    frame_data_url: str


class RemoveTrackRequest(BaseModel):
    driver_id: int


def decode_data_url_image(data_url: str) -> np.ndarray:
    if "," in data_url:
        _, encoded = data_url.split(",", 1)
    else:
        encoded = data_url

    image_bytes = base64.b64decode(encoded)
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    if image is None:
        raise ValueError("Failed to decode image")

    return image


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/tracker/reset")
def reset_tracker() -> dict:
    engine.reset()
    return {"ok": True}


@app.post("/tracker/init")
def init_tracker(req: InitTrackRequest) -> dict:
    frame = decode_data_url_image(req.frame_data_url)
    ok = engine.initialize_track(
        driver_id=req.driver_id,
        frame_bgr=frame,
        x=req.x,
        y=req.y,
        patch_w=req.patch_w,
        patch_h=req.patch_h,
        search_radius=req.search_radius,
    )
    return {"ok": ok}


@app.post("/tracker/update")
def update_tracker(req: UpdateRequest) -> dict:
    frame = decode_data_url_image(req.frame_data_url)
    results = engine.update(frame)
    return {
        "ok": True,
        "results": [
            {
                "driver_id": r.driver_id,
                "x": r.x,
                "y": r.y,
                "confidence": r.confidence,
                "status": r.status,
            }
            for r in results
        ],
    }


@app.post("/tracker/remove")
def remove_tracker(req: RemoveTrackRequest) -> dict:
    engine.remove(req.driver_id)
    return {"ok": True}