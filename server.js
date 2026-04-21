// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "race.json");
const PRESETS_FILE = path.join(__dirname, "data", "presets.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function loadJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function saveJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeTrackName(value, fallback = "TRACK") {
  return String(value || fallback).trim().toUpperCase() || "TRACK";
}

function normalizeName(value) {
  return String(value || "").trim();
}

function normalizeColor(value, fallback = "#52ff52") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeId(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortDrivers(drivers) {
  return [...drivers].sort((a, b) => {
    const posA = Number(a.position);
    const posB = Number(b.position);
    if (Number.isFinite(posA) && Number.isFinite(posB)) return posA - posB;
    if (Number.isFinite(posA)) return -1;
    if (Number.isFinite(posB)) return 1;
    return 0;
  });
}

function normalizeDriver(driver, index, existingByName = new Map(), existingById = new Map()) {
  const name = normalizeName(driver.name);
  const incomingId = Number(driver.id);

  const matchedById = Number.isFinite(incomingId) ? existingById.get(incomingId) : null;
  const matchedByName = name ? existingByName.get(name) : null;
  const existing = matchedById || matchedByName || null;

  return {
    id: Number.isFinite(incomingId)
      ? incomingId
      : normalizeId(existing && existing.id, index + 1),
    name,
    position: normalizeId(driver.position, index + 1),
    primaryColor: normalizeColor(driver.primaryColor, existing ? existing.primaryColor : "#52ff52")
  };
}

function normalizeDrivers(drivers, existingDrivers = []) {
  const existingByName = new Map(
    (existingDrivers || [])
      .map((driver) => ({
        ...driver,
        name: normalizeName(driver.name)
      }))
      .filter((driver) => driver.name)
      .map((driver) => [driver.name, driver])
  );

  const existingById = new Map(
    (existingDrivers || [])
      .filter((driver) => Number.isFinite(Number(driver.id)))
      .map((driver) => [Number(driver.id), driver])
  );

  return sortDrivers(Array.isArray(drivers) ? drivers : []).map((driver, index) =>
    normalizeDriver(driver, index, existingByName, existingById)
  );
}

function loadRaceData() {
  const parsed = loadJsonFile(DATA_FILE, { trackName: "TRACK", drivers: [] });

  return {
    trackName: normalizeTrackName(parsed.trackName),
    drivers: normalizeDrivers(parsed.drivers || [])
  };
}

function saveRaceData(data) {
  saveJsonFile(DATA_FILE, {
    trackName: normalizeTrackName(data.trackName),
    drivers: normalizeDrivers(data.drivers || [])
  });
}

function loadPresets() {
  const parsed = loadJsonFile(PRESETS_FILE, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const normalized = {};
  for (const [presetName, preset] of Object.entries(parsed)) {
    normalized[String(presetName).trim()] = {
      trackName: normalizeTrackName(preset && preset.trackName),
      drivers: normalizeDrivers((preset && preset.drivers) || [])
    };
  }

  return normalized;
}

function savePresets(presets) {
  const cleaned = {};
  for (const [presetName, preset] of Object.entries(presets || {})) {
    const safeName = String(presetName || "").trim();
    if (!safeName) continue;

    cleaned[safeName] = {
      trackName: normalizeTrackName(preset && preset.trackName),
      drivers: normalizeDrivers((preset && preset.drivers) || [])
    };
  }

  saveJsonFile(PRESETS_FILE, cleaned);
}

app.get("/", (req, res) => {
  res.redirect("/control.html");
});

app.get("/api/race", (req, res) => {
  const data = loadRaceData();
  res.json(data);
});

app.post("/api/update", (req, res) => {
  try {
    const current = loadRaceData();
    const incomingDrivers = Array.isArray(req.body.drivers) ? req.body.drivers : current.drivers;

    const data = {
      trackName: normalizeTrackName(req.body.trackName, current.trackName),
      drivers: normalizeDrivers(incomingDrivers, current.drivers)
    };

    saveRaceData(data);
    io.emit("raceUpdate", data);

    res.json({ ok: true, data });
  } catch (err) {
    console.error("Failed to update race data:", err);
    res.status(500).json({ ok: false, error: "Failed to update race data" });
  }
});

app.get("/api/presets", (req, res) => {
  try {
    const presets = loadPresets();
    const presetNames = Object.keys(presets).sort((a, b) => a.localeCompare(b));
    res.json({ ok: true, presets: presetNames });
  } catch (err) {
    console.error("Failed to load presets:", err);
    res.status(500).json({ ok: false, error: "Failed to load presets" });
  }
});

app.get("/api/presets/:name", (req, res) => {
  try {
    const presetName = String(req.params.name || "").trim();
    const presets = loadPresets();

    if (!presetName || !presets[presetName]) {
      return res.status(404).json({ ok: false, error: "Preset not found" });
    }

    res.json({ ok: true, preset: presets[presetName] });
  } catch (err) {
    console.error("Failed to load preset:", err);
    res.status(500).json({ ok: false, error: "Failed to load preset" });
  }
});

app.post("/api/presets/:name", (req, res) => {
  try {
    const presetName = String(req.params.name || "").trim();
    if (!presetName) {
      return res.status(400).json({ ok: false, error: "Preset name required" });
    }

    const current = loadRaceData();
    const trackName = normalizeTrackName(req.body.trackName, current.trackName);
    const incomingDrivers = Array.isArray(req.body.drivers) ? req.body.drivers : current.drivers;

    const presets = loadPresets();
    presets[presetName] = {
      trackName,
      drivers: normalizeDrivers(incomingDrivers, current.drivers)
    };

    savePresets(presets);

    res.json({ ok: true, presetName });
  } catch (err) {
    console.error("Failed to save preset:", err);
    res.status(500).json({ ok: false, error: "Failed to save preset" });
  }
});

app.delete("/api/presets/:name", (req, res) => {
  try {
    const presetName = String(req.params.name || "").trim();
    const presets = loadPresets();

    if (!presetName || !presets[presetName]) {
      return res.status(404).json({ ok: false, error: "Preset not found" });
    }

    delete presets[presetName];
    savePresets(presets);

    res.json({ ok: true, presetName });
  } catch (err) {
    console.error("Failed to delete preset:", err);
    res.status(500).json({ ok: false, error: "Failed to delete preset" });
  }
});

io.on("connection", (socket) => {
  const data = loadRaceData();
  socket.emit("raceUpdate", data);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});