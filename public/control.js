console.log("CONTROL JS LOADED");

const table = document.getElementById("driverTable");
const trackNameInput = document.getElementById("trackNameInput");
const trackSaveBtn = document.getElementById("trackSaveBtn");

const goldBtn = document.getElementById("goldSilverBronzeBtn");
const greenBtn = document.getElementById("greenThemeBtn");
const randomBtn = document.getElementById("randomizeBtn");

const presetNameInput = document.getElementById("presetNameInput");
const savePresetBtn = document.getElementById("savePresetBtn");
const loadPresetBtn = document.getElementById("loadPresetBtn");

const newDriverName = document.getElementById("newDriverName");
const newDriverColor = document.getElementById("newDriverColor");
const addDriverBtn = document.getElementById("addDriverBtn");

let drivers = [];
let draggedIndex = null;

const DEFAULT_COLOR = "#52ff52";

function normalizeColor(c) {
  return typeof c === "string" && c.trim() ? c.trim() : DEFAULT_COLOR;
}

function normalizeName(n) {
  return String(n || "").trim();
}

function updatePositions() {
  drivers = drivers.map((d, i) => ({
    ...d,
    position: i + 1,
    name: normalizeName(d.name),
    primaryColor: normalizeColor(d.primaryColor)
  }));
}

async function loadData() {
  const res = await fetch("/api/race");
  const data = await res.json();

  trackNameInput.value = data.trackName || "TRACK";

  drivers = (data.drivers || [])
    .map((d, i) => ({
      name: normalizeName(d.name),
      position: Number.isFinite(Number(d.position)) ? Number(d.position) : i + 1,
      primaryColor: normalizeColor(d.primaryColor)
    }))
    .sort((a, b) => a.position - b.position);

  updatePositions();
  render();
}

function render() {
  table.innerHTML = "";

  drivers.forEach((driver, index) => {
    const row = document.createElement("tr");
    row.draggable = true;
    row.dataset.index = index;

    row.innerHTML = `
      <td class="grab">☰</td>
      <td>P${driver.position}</td>
      <td><input class="name-input" value="${escapeHtml(driver.name)}" /></td>
      <td><input class="color-input" type="color" value="${driver.primaryColor}" /></td>
      <td>
        <button class="up-btn" ${index === 0 ? "disabled" : ""}>⬆</button>
        <button class="down-btn" ${index === drivers.length - 1 ? "disabled" : ""}>⬇</button>
        <button class="remove-btn">X</button>
      </td>
    `;

    const nameInput = row.querySelector(".name-input");
    const colorInput = row.querySelector(".color-input");
    const upBtn = row.querySelector(".up-btn");
    const downBtn = row.querySelector(".down-btn");
    const removeBtn = row.querySelector(".remove-btn");

    nameInput.addEventListener("change", async (e) => {
      drivers[index].name = normalizeName(e.target.value);
      render();
      await sendUpdate();
    });

    colorInput.addEventListener("change", async (e) => {
      drivers[index].primaryColor = normalizeColor(e.target.value);
      await sendUpdate();
    });

    upBtn.addEventListener("click", async () => {
      if (index === 0) return;
      [drivers[index - 1], drivers[index]] = [drivers[index], drivers[index - 1]];
      updatePositions();
      render();
      await sendUpdate();
    });

    downBtn.addEventListener("click", async () => {
      if (index === drivers.length - 1) return;
      [drivers[index], drivers[index + 1]] = [drivers[index + 1], drivers[index]];
      updatePositions();
      render();
      await sendUpdate();
    });

    removeBtn.addEventListener("click", async () => {
      drivers.splice(index, 1);
      updatePositions();
      render();
      await sendUpdate();
    });

    row.addEventListener("dragstart", () => {
      draggedIndex = index;
      row.classList.add("dragging");
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearDropTargets();
      draggedIndex = null;
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("drop-target");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drop-target");
    });

    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      if (draggedIndex === null || draggedIndex === index) return;

      const moved = drivers.splice(draggedIndex, 1)[0];
      drivers.splice(index, 0, moved);

      updatePositions();
      render();
      await sendUpdate();
      draggedIndex = null;
    });

    table.appendChild(row);
  });
}

function clearDropTargets() {
  table.querySelectorAll("tr").forEach((row) => row.classList.remove("drop-target"));
}

async function sendUpdate() {
  updatePositions();

  const payload = {
    trackName: trackNameInput.value.trim().toUpperCase() || "TRACK",
    drivers: drivers.filter((d) => normalizeName(d.name)).map((d, i) => ({
      name: normalizeName(d.name),
      position: i + 1,
      primaryColor: normalizeColor(d.primaryColor)
    }))
  };

  console.log("SEND:", payload);

  await fetch("/api/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function applyPaletteTop3() {
  const colors = ["#FFD700", "#C0C0C0", "#CD7F32"];
  drivers = drivers.map((d, i) => ({
    ...d,
    primaryColor: colors[i] || d.primaryColor
  }));
  render();
  sendUpdate();
}

function applyGreenTheme() {
  drivers = drivers.map((d) => ({ ...d, primaryColor: "#52ff52" }));
  render();
  sendUpdate();
}

function randomizeColors() {
  drivers = drivers.map((d) => ({
    ...d,
    primaryColor: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")
  }));
  render();
  sendUpdate();
}

function savePreset(name) {
  const presetName = normalizeName(name);
  if (!presetName) {
    alert("Enter a preset name first.");
    return;
  }

  const presetData = {
    trackName: trackNameInput.value.trim().toUpperCase() || "TRACK",
    drivers: drivers.map((d, i) => ({
      name: normalizeName(d.name),
      position: i + 1,
      primaryColor: normalizeColor(d.primaryColor)
    }))
  };

  localStorage.setItem(`racePreset_${presetName}`, JSON.stringify(presetData));
  console.log("Preset saved:", presetName, presetData);
  alert(`Preset "${presetName}" saved.`);
}

async function loadPreset(name) {
  const presetName = normalizeName(name);
  if (!presetName) {
    alert("Enter a preset name first.");
    return;
  }

  const raw = localStorage.getItem(`racePreset_${presetName}`);
  if (!raw) {
    alert(`Preset "${presetName}" not found.`);
    return;
  }

  const presetData = JSON.parse(raw);

  trackNameInput.value = presetData.trackName || "TRACK";
  drivers = (presetData.drivers || [])
    .map((d, i) => ({
      name: normalizeName(d.name),
      position: Number.isFinite(Number(d.position)) ? Number(d.position) : i + 1,
      primaryColor: normalizeColor(d.primaryColor)
    }))
    .sort((a, b) => a.position - b.position);

  updatePositions();
  render();
  await sendUpdate();

  console.log("Preset loaded:", presetName, presetData);
  alert(`Preset "${presetName}" loaded.`);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

trackSaveBtn.addEventListener("click", async () => {
  await sendUpdate();
});

goldBtn.addEventListener("click", () => {
  applyPaletteTop3();
});

greenBtn.addEventListener("click", () => {
  applyGreenTheme();
});

randomBtn.addEventListener("click", () => {
  randomizeColors();
});

savePresetBtn.addEventListener("click", () => {
  savePreset(presetNameInput.value);
});

loadPresetBtn.addEventListener("click", async () => {
  await loadPreset(presetNameInput.value);
});

addDriverBtn.addEventListener("click", async () => {
  const name = normalizeName(newDriverName.value);
  if (!name) return;

  drivers.push({
    name,
    position: drivers.length + 1,
    primaryColor: normalizeColor(newDriverColor.value)
  });

  updatePositions();
  render();
  await sendUpdate();

  newDriverName.value = "";
  newDriverColor.value = DEFAULT_COLOR;
});

newDriverName.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addDriverBtn.click();
  }
});

window.addEventListener("keydown", async (e) => {
  if (e.key === "1") savePreset("race1");
  if (e.key === "2") await loadPreset("race1");
});

savePresetBtn?.addEventListener("click", () => {
    const name = normalizeName(presetNameInput?.value);
    console.log("SAVE CLICKED", { name, presetNameInput, savePresetBtn });
  
    if (!name) {
      alert("Enter a preset name first.");
      return;
    }
  
    const presetData = {
      trackName: trackNameInput.value.trim().toUpperCase() || "TRACK",
      drivers: drivers.map((d, i) => ({
        name: normalizeName(d.name),
        position: i + 1,
        primaryColor: normalizeColor(d.primaryColor)
      }))
    };
  
    localStorage.setItem(`racePreset_${name}`, JSON.stringify(presetData));
    alert(`Saved preset: ${name}`);
  });
  
  loadPresetBtn?.addEventListener("click", async () => {
    const name = normalizeName(presetNameInput?.value);
    console.log("LOAD CLICKED", { name, presetNameInput, loadPresetBtn });
  
    if (!name) {
      alert("Enter a preset name first.");
      return;
    }
  
    const raw = localStorage.getItem(`racePreset_${name}`);
    console.log("PRESET RAW", raw);
  
    if (!raw) {
      alert(`Preset "${name}" not found.`);
      return;
    }
  
    const presetData = JSON.parse(raw);
  
    trackNameInput.value = presetData.trackName || "TRACK";
    drivers = (presetData.drivers || []).map((d, i) => ({
      name: normalizeName(d.name),
      position: Number.isFinite(Number(d.position)) ? Number(d.position) : i + 1,
      primaryColor: normalizeColor(d.primaryColor)
    }));
  
    updatePositions();
    render();
    await sendUpdate();
  
    alert(`Loaded preset: ${name}`);
  });
loadData();