// js/features.js — UI features and ride summary controls
import { S, setState, status } from './state.js';
import { setNum } from './state.js';
import { formatDuration, fmtDuration } from './utils.js';
import { sendErg, bluetoothDiagnostic } from './bluetooth.js';
import { setMapTile } from './route.js';
import { log } from './state.js';

export function updateSummaryOverlay() {
  const overlay = document.getElementById('summaryOverlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !S.summaryOpen);
}

export function renderSummary() {
  if (!S.summaryOpen) return;
  const duration = S.elapsed;
  const avgPower = S.records.length ? Math.round(S.records.reduce((sum, r) => sum + r.power, 0) / S.records.length) : 0;
  const maxPower = S.records.length ? Math.max(...S.records.map(r => r.power)) : 0;
  const avgHr = S.records.length ? Math.round(S.records.reduce((sum, r) => sum + (r.hr || 0), 0) / S.records.length) : 0;
  const climb = S.route.length ? S.route.reduce((sum, p, i) => i ? sum + Math.max(0, p.ele - S.route[i - 1].ele) : sum, 0) : 0;
  const durationEl = document.getElementById('summaryDuration');
  if (durationEl) durationEl.textContent = formatDuration(duration);
  const distanceEl = document.getElementById('summaryDistance');
  if (distanceEl) distanceEl.textContent = (S.distance / 1000).toFixed(2) + ' km';
  const avgPowerEl = document.getElementById('summaryAvgPower');
  if (avgPowerEl) avgPowerEl.textContent = avgPower + ' W';
  const maxPowerEl = document.getElementById('summaryMaxPower');
  if (maxPowerEl) maxPowerEl.textContent = maxPower + ' W';
  const climbEl = document.getElementById('summaryClimb');
  if (climbEl) climbEl.textContent = Math.round(climb) + ' m';
  const avgHrEl = document.getElementById('summaryAvgHr');
  if (avgHrEl) avgHrEl.textContent = (avgHr || '--') + ' bpm';
  if (window.drawPowerDurationCurve) window.drawPowerDurationCurve(document.getElementById('summaryPdcChart'), S.records, S.ftp);
}

export function openSummary() {
  setState({ summaryOpen: true });
  updateSummaryOverlay();
  renderSummary();
}

export function closeSummary() {
  setState({ summaryOpen: false });
  updateSummaryOverlay();
}

export function startFtpRampTest() {
  setState({ rampTest: { active: true, stage: 'warmup', step: 0, targetPower: 100, lastStepMs: Date.now() } });
  const btn = document.getElementById('ftpRampBtn');
  if (btn) btn.textContent = 'Stop Ramp';
  status('FTP ramp test started');
}

export function stopFtpRampTest() {
  setState({ rampTest: { active: false, stage: 'idle', step: 0, targetPower: 100, lastStepMs: 0 } });
  const btn = document.getElementById('ftpRampBtn');
  if (btn) btn.textContent = 'FTP Ramp Test';
  status('FTP ramp test stopped');
}

export function updateRampTest() {
  if (!S.rampTest.active) return;
  const now = Date.now();
  const elapsed = (now - S.rampTest.lastStepMs) / 1000;
  const interval = 30;
  let { step, targetPower } = S.rampTest;
  if (elapsed >= interval) {
    step++;
    targetPower = Math.min(600, 100 + step * 20);
    setState({ rampTest: { ...S.rampTest, step, targetPower, lastStepMs: now } });
    status('Ramp target ' + targetPower + ' W');
  }
  S.power = targetPower;
  if (S.erg && S.ctrlChar) sendErg(S.power);
}

export function initFeatureUI() {
  const tiles = document.getElementById('tileSelector');
  if (tiles) { tiles.value = S.mapTile || 'osm'; tiles.onchange = e => setMapTile(e.target.value || 'osm'); }
  const summary = document.getElementById('summaryBtn');
  if (summary) summary.onclick = openSummary;
  const closeSummaryBtn = document.getElementById('closeSummaryBtn');
  if (closeSummaryBtn) closeSummaryBtn.onclick = closeSummary;
  const ftpRamp = document.getElementById('ftpRampBtn');
  if (ftpRamp) ftpRamp.onclick = () => S.rampTest.active ? stopFtpRampTest() : startFtpRampTest();
  updateSummaryOverlay();
}

export function initApp() {
  status('Ready. Upload a GPX/FIT course or start demo.');
  const btProblem = bluetoothDiagnostic();
  if (btProblem) log('Bluetooth check: ' + btProblem);
  else log('Bluetooth check: available');
}
