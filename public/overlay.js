const rows = document.getElementById("rows");
const trackNameEl = document.getElementById("trackName");

const rowMap = new Map();
let previousPositions = new Map();

function getRowClass(index) {
  let rowClass = "row";
  if (index === 0) rowClass += " podium-1";
  if (index === 1) rowClass += " podium-2";
  if (index === 2) rowClass += " podium-3";
  return rowClass;
}

function getPosClass(position) {
  let posClass = "pos";
  if (position === 1) posClass += " p1";
  if (position === 2) posClass += " p2";
  if (position === 3) posClass += " p3";
  return posClass;
}

function createRow(driver, index) {
  const row = document.createElement("div");
  row.className = getRowClass(index);
  row.dataset.driverId = driver.name;

  row.innerHTML = `
    <div class="bar" style="background:${driver.primaryColor || "#52ff52"}"></div>
    <div class="${getPosClass(driver.position)}">${driver.position}</div>
    <div class="name">${driver.name}</div>
  `;

  return row;
}

function updateRow(row, driver, index) {
  row.className = getRowClass(index);
  row.dataset.driverId = driver.name;

  row.innerHTML = `
    <div class="bar" style="background:${driver.primaryColor || "#52ff52"}"></div>
    <div class="${getPosClass(driver.position)}">${driver.position}</div>
    <div class="name">${driver.name}</div>
  `;
}

function animateReorder(sortedDrivers) {
  const oldRects = new Map();

  Array.from(rows.children).forEach((child) => {
    oldRects.set(child.dataset.driverId, child.getBoundingClientRect());
  });

  const fragment = document.createDocumentFragment();

  sortedDrivers.forEach((driver, index) => {
    let row = rowMap.get(driver.name);

    if (!row) {
      row = createRow(driver, index);
      rowMap.set(driver.name, row);
    } else {
      updateRow(row, driver, index);
    }

    fragment.appendChild(row);
  });

  rows.replaceChildren(fragment);

  sortedDrivers.forEach((driver) => {
    const row = rowMap.get(driver.name);
    const oldPos = previousPositions.get(driver.name);
    const newPos = driver.position;

    row.classList.remove("moved-up", "moved-down");

    if (typeof oldPos === "number") {
      if (newPos < oldPos) {
        row.classList.add("moved-up");
        setTimeout(() => row.classList.remove("moved-up"), 550);
      } else if (newPos > oldPos) {
        row.classList.add("moved-down");
        setTimeout(() => row.classList.remove("moved-down"), 550);
      }
    }
  });

  sortedDrivers.forEach((driver) => {
    const row = rowMap.get(driver.name);
    const oldRect = oldRects.get(driver.name);
    const newRect = row.getBoundingClientRect();

    if (oldRect) {
      const deltaY = oldRect.top - newRect.top;
      if (deltaY) {
        row.style.transform = `translateY(${deltaY}px)`;
        row.getBoundingClientRect();
        row.style.transform = "translateY(0)";
      }
    } else {
      row.style.opacity = "0";
      row.style.transform = "translateY(-6px)";
      requestAnimationFrame(() => {
        row.style.opacity = "1";
        row.style.transform = "translateY(0)";
      });
    }
  });

  previousPositions = new Map(sortedDrivers.map((d) => [d.name, d.position]));
}

function render(data) {
  if (!data || !Array.isArray(data.drivers)) {
    rows.innerHTML = '<div class="error">No data</div>';
    return;
  }

  trackNameEl.textContent = data.trackName || "TRACK";

  const sortedDrivers = data.drivers
    .slice()
    .sort((a, b) => a.position - b.position);

  animateReorder(sortedDrivers);
}

fetch("/api/race")
  .then((r) => r.json())
  .then(render)
  .catch(() => {
    rows.innerHTML = '<div class="error">Failed to load data</div>';
  });

const socket = io();
socket.on("raceUpdate", render);