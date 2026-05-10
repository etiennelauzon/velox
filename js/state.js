// js/state.js — centralized app state and event bus
export const S = {
  trainer: null, hrm: null, server: null, hrServer: null,
  bikeChar: null, ctrlChar: null,
  connected: false, hrConnected: false, demo: false, recording: false, erg: false, gradeErg: false,
  ftp: 250, lthr: 165, ergWatts: 200,
  power: 0, cadence: 0, speed: 0, vMps: 0, trainerSpeed: 0, hr: 0,
  distance: 0, routeDistance: 0, calories: 0, elapsed: 0, lastTs: 0, startMs: 0,
  physics: {
    riderWeightKg: 72, bikeWeightKg: 10, rho: 1.225, g: 9.81,
    crr: 0.0045, cda: 0.32, drivetrainEfficiency: 0.97, tau: 2.7,
    minTargetMps: 0.1, maxTargetMps: 35, gradeWindowM: 85,
  },
  stravaSegments: [], activeSegment: null, segmentTimes: {},
  records: [], history: [], timer: null, demoTimer: null,
  route: [], routeLen: 0, routeName: 'No course',
  map: null, line: null, rider: null,
  mapTile: 'osm', mapTileLayer: null,
  summaryOpen: false,
  rampTest: { active: false, stage: 'idle', step: 0, targetPower: 100, lastStepMs: 0 },
  live: {
    socket: null, connected: false, room: '', name: '',
    clientId: '', peers: new Map(), markers: new Map(),
    webRTCpeers: new Map(), lastSent: 0, rateMs: 1000, color: '#19d3ef',
  },
  mly: null, // Mapillary state, initialized by streetview module
};

const listeners = new Set();

export const Store = {
  emit(change) {
    listeners.forEach(fn => fn(S, change));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

let renderQueued = false;

export function setState(patch) {
  Object.assign(S, patch);
  Store.emit(patch);
}

export function mutateState(fn, label) {
  fn(S);
  Store.emit(label || { type: 'mutation' });
}

export function scheduleUI(callback) {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (callback) callback();
  });
}

export function loadPersistedSettings() {
  const keys = ['ftp', 'lthr', 'ergWatts'];
  for (const k of keys) {
    const v = localStorage.getItem('velox_' + k);
    if (v !== null) {
      S[k] = Number(v);
      const el = document.getElementById(k);
      if (el) el.value = S[k];
    }
  }
  const w = localStorage.getItem('velox_riderWeightKg');
  if (w) {
    S.physics.riderWeightKg = Number(w);
    const el = document.getElementById('riderWeight');
    if (el) el.value = S.physics.riderWeightKg;
  }
}

export function saveSetting(key, value) {
  localStorage.setItem('velox_' + key, value);
}

export function getEl(id) {
  return document.getElementById(id);
}

export function setNum(id, v) {
  const el = getEl(id);
  if (el) el.textContent = v;
}

export function status(msg) {
  const el = getEl('status');
  if (el) el.textContent = msg;
}

export function log(msg) {
  const t = new Date().toLocaleTimeString();
  const logEl = getEl('log');
  if (logEl) logEl.textContent = '[' + t + '] ' + msg + '\n' + logEl.textContent;
}
