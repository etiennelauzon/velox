// js/bluetooth.js — Web Bluetooth trainer and HRM integration
import { S, Store, setState, status, log } from './state.js';
import { clamp, solveSpeedFromPower, smoothSpeed } from './physics.js';
import { setBusy } from './utils.js';
import { positionAt, getSmoothedGradeFromGPX } from './route.js';
import { updateSegmentChronometer } from './segments.js';

export function bluetoothDiagnostic() {
  if (!window.isSecureContext) return 'Web Bluetooth needs localhost or HTTPS. Open http://localhost:8010/velox-myrider.html directly in Chrome or Edge.';
  if (!navigator.bluetooth) return 'Web Bluetooth is not exposed by this browser. Use desktop Chrome or Microsoft Edge, not Firefox/Safari/VS Code preview.';
  return '';
}

export async function connectTrainer() {
  const btProblem = bluetoothDiagnostic();
  if (btProblem) { status(btProblem); return; }
  try {
    status('Scanning for FTMS trainer');
    const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['fitness_machine'] });
    S.trainer = dev;
    dev.addEventListener('gattserverdisconnected', () => { S.connected = false; document.getElementById('dot').classList.remove('on'); status('Trainer disconnected'); });
    const server = await dev.gatt.connect();
    S.server = server;
    const ftms = await server.getPrimaryService('fitness_machine');
    const bike = await ftms.getCharacteristic('00002ad2-0000-1000-8000-00805f9b34fb');
    bike.addEventListener('characteristicvaluechanged', parseBike);
    await bike.startNotifications();
    S.bikeChar = bike;
    try {
      S.ctrlChar = await ftms.getCharacteristic('00002ad9-0000-1000-8000-00805f9b34fb');
      await S.ctrlChar.startNotifications();
      await S.ctrlChar.writeValueWithResponse(new Uint8Array([0x00]));
    } catch (e) {
      log('Trainer control point unavailable');
    }
    S.connected = true;
    document.getElementById('dot').classList.add('on');
    document.getElementById('trainerBtn').textContent = dev.name || 'Trainer Connected';
    status('Trainer connected: ' + (dev.name || 'FTMS device'));
  } catch (e) {
    if (e.name !== 'NotFoundError') status('Trainer error: ' + e.message);
  }
}

export async function connectGattWithRetry(dev, label) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (dev.gatt.connected) dev.gatt.disconnect();
      await new Promise(r => setTimeout(r, attempt === 1 ? 100 : 700));
      status(label + ' GATT connect attempt ' + attempt);
      return await dev.gatt.connect();
    } catch (e) {
      last = e;
      log(label + ' attempt ' + attempt + ' failed: ' + e.name + ' ' + e.message);
    }
  }
  throw last;
}

export function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out after ' + Math.round(ms / 1000) + 's')), ms))
  ]);
}

export function garminHrmTip(dev) {
  const name = (dev?.name || '').toLowerCase();
  return name.includes('fenix') || name.includes('garmin') ? ' This Garmin endpoint connected, but did not expose a usable Web Bluetooth Heart Rate service. Try the HRM-Pro Plus chest strap, Virtual Run after forgetting the device in Chrome/Windows, or enter HR manually for now.' : '';
}

export async function connectHrm() {
  const btProblem = bluetoothDiagnostic();
  if (btProblem) { status(btProblem); return; }
  try {
    status('Scanning for heart rate monitor');
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }], optionalServices: ['battery_service', 'device_information'] });
    S.hrm = dev;
    dev.addEventListener('gattserverdisconnected', () => { S.hrConnected = false; document.getElementById('hrmBtn').textContent = 'Connect HRM'; status('HRM disconnected'); });
    const server = await connectGattWithRetry(dev, 'HRM');
    S.hrServer = server;
    status('Looking for Heart Rate service on ' + (dev.name || 'selected device'));
    try {
      const services = await withTimeout(server.getPrimaryServices(), 12000, 'BLE service discovery');
      log('Allowed BLE services: ' + (services.map(s => s.uuid).join(', ') || 'none returned'));
    } catch (e) {
      log('BLE service discovery note: ' + e.message);
    }
    const svc = await withTimeout(server.getPrimaryService('heart_rate'), 20000, 'Heart Rate service lookup');
    const chr = await withTimeout(svc.getCharacteristic('00002a37-0000-1000-8000-00805f9b34fb'), 12000, 'Heart Rate measurement lookup');
    chr.addEventListener('characteristicvaluechanged', parseHr);
    await withTimeout(chr.startNotifications(), 12000, 'Heart Rate notifications');
    S.hrConnected = true;
    document.getElementById('hrmBtn').textContent = dev.name || 'HRM Connected';
    status('HRM connected: ' + (dev.name || 'Heart Rate'));
  } catch (e) {
    if (e.name !== 'NotFoundError') status('HRM error: ' + e.name + ' ' + e.message + garminHrmTip(S.hrm));
  }
}

export function parseBike(ev) {
  const v = ev.target.value;
  const flags = v.getUint16(0, true);
  let o = 2;
  if (!(flags & 1)) { S.trainerSpeed = v.getUint16(o, true) * 0.01; o += 2; }
  if (flags & 2) o += 2;
  if (flags & 4) { S.cadence = v.getUint16(o, true) * 0.5; o += 2; }
  if (flags & 8) o += 2;
  if (flags & 16) o += 3;
  if (flags & 32) o += 2;
  if (flags & 64) { S.power = Math.max(0, v.getInt16(o, true)); o += 2; }
  if (flags & 128) o += 2;
  if (flags & 256) { const cal = v.getUint16(o, true); if (cal !== 0xffff) S.calories = cal; o += 5; }
  if (flags & 512) { S.hr = v.getUint8(o); o++; }
  sample();
}

export function parseHr(ev) {
  const v = ev.target.value;
  const f = v.getUint8(0);
  setState({ hr: (f & 1) ? v.getUint16(1, true) : v.getUint8(1) });
}

export function startDemo() {
  S.demo = true;
  document.getElementById('demoBtn').textContent = 'Stop Demo';
  document.getElementById('dot').classList.add('on');
  let t = 0;
  S.demoTimer = setInterval(() => {
    t += 0.08;
    const target = S.erg ? S.ergWatts : 210 + Math.sin(t) * 70 + Math.sin(t * 2.3) * 28;
    S.power = clamp(target + (Math.random() - 0.5) * 16, 0, 900);
    S.cadence = 88 + Math.sin(t * 0.8) * 8 + (Math.random() - 0.5) * 3;
    S.hr = 132 + S.power * 0.11 + Math.sin(t * 0.25) * 5;
    sample();
  }, 1000);
  status('Demo stream active');
}

export function stopDemo() {
  S.demo = false;
  clearInterval(S.demoTimer);
  document.getElementById('demoBtn').textContent = 'Demo';
  if (!S.connected) document.getElementById('dot').classList.remove('on');
  status('Demo stopped');
}

export function startRide() {
  if (!S.connected && !S.demo) { status('Connect a trainer or start demo'); return; }
  S.recording = true;
  S.records = [];
  S.distance = 0;
  S.routeDistance = 0;
  S.vMps = 0;
  S.speed = 0;
  S.calories = 0;
  S.elapsed = 0;
  S.startMs = Date.now();
  S.lastTs = 0;
  S.activeSegment = null;
  S.segmentTimes = {};
  const recBtn = document.getElementById('recBtn');
  if (recBtn) { recBtn.textContent = 'Stop'; recBtn.classList.add('danger'); }
  document.getElementById('dot').classList.add('rec');
  document.getElementById('gpxBtn').disabled = true;
  document.getElementById('fitBtn').disabled = true;
  S.timer = setInterval(() => { S.elapsed = Math.floor((Date.now() - S.startMs) / 1000); Store.emit({ type: 'tick' }); }, 1000);
  status('Recording started');
}

export function stopRide() {
  S.recording = false;
  clearInterval(S.timer);
  const recBtn = document.getElementById('recBtn');
  if (recBtn) { recBtn.textContent = 'Start'; recBtn.classList.remove('danger'); }
  document.getElementById('dot').classList.remove('rec');
  document.getElementById('gpxBtn').disabled = !S.records.length;
  document.getElementById('fitBtn').disabled = !S.records.length;
  status('Recording stopped: ' + S.records.length + ' samples');
}

export async function sendErg(w) {
  S.ergWatts = Math.round(clamp(w, 50, 1500));
  const input = document.getElementById('ergWatts');
  if (input) input.value = S.ergWatts;
  if (!S.ctrlChar) return;
  try {
    await S.ctrlChar.writeValueWithResponse(new Uint8Array([0x05, S.ergWatts & 255, (S.ergWatts >> 8) & 255]));
  } catch (e) {
    log('ERG write failed: ' + e.message);
  }
}

export function gradeWatts(grade) {
  return clamp(S.ergWatts + grade * 18, 70, 800);
}

export function stepSimulation(dt) {
  const safeDt = clamp(Number(dt) || 1, 0.05, 3);
  const grade = getSmoothedGradeFromGPX(S.routeDistance, S.physics.gradeWindowM);
  const target = solveSpeedFromPower(S.power, grade);
  S.vMps = smoothSpeed(S.vMps, target, safeDt, S.physics.tau);
  S.speed = clamp(S.vMps * 3.6, 0, S.physics.maxTargetMps * 3.6);
  return { meters: S.vMps * safeDt, grade, targetMps: target };
}

export function sample() {
  const now = Date.now();
  const dt = S.lastTs ? (now - S.lastTs) / 1000 : 1;
  S.lastTs = now;
  const prevRouteDistance = S.routeDistance;
  const sim = stepSimulation(dt);
  const meters = sim.meters;
  S.routeDistance += meters;
  S.distance += meters;
  updateSegmentChronometer(prevRouteDistance, S.routeDistance, now);
  if (S.recording) {
    S.elapsed = Math.floor((now - S.startMs) / 1000);
    S.calories += Math.max(0, S.power) * dt / 1000 * 0.86;
    const pos = positionAt(S.routeDistance);
    S.records.push({
      time: now,
      power: Math.round(S.power),
      cadence: Math.round(S.cadence) || 0,
      speed: S.speed,
      hr: Math.round(S.hr) || 0,
      distance: S.distance,
      lat: pos.lat,
      lon: pos.lon,
      ele: pos.ele,
      grade: sim.grade,
    });
    if (S.gradeErg && S.ctrlChar && S.erg) sendErg(gradeWatts(sim.grade));
  }
  S.history.push(S.power);
  if (S.history.length > 300) S.history.shift();
  Store.emit({ type: 'sample' });
}
