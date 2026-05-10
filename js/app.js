import { S, Store, loadPersistedSettings, status, log, setNum, setState, scheduleUI, getEl, saveSetting } from './state.js';
import { connectTrainer, connectHrm, startDemo, stopDemo, startRide, stopRide, sendErg, bluetoothDiagnostic } from './bluetooth.js';
import { buildGPX, buildFIT, download } from './export.js';
import { uploadCourse, loadPresetRoute, clearCourse, setMapTile, updateRouteReadout } from './route.js';
import { LiveShare } from './live.js';
import { initFeatureUI, initApp, openSummary, closeSummary, startFtpRampTest, stopFtpRampTest, updateRampTest, renderSummary } from './features.js';
import { drawChart, drawElevationAndPdc } from './chart.js';
import { loadStravaStarredSegments, updateSegmentReadout } from './segments.js';
import { powerZone, lthrZone, fmtTime } from './physics.js';
import { initMapillary } from './mapillary.js';

function updateUINow() {
  const zone = powerZone(S.power);
  const panel = getEl('powerPanel');
  if (panel) panel.style.setProperty('--zone', zone[1]);

  setNum('power', Math.round(S.power));
  setNum('cadence', Math.round(S.cadence) || 0);
  setNum('speed', S.speed.toFixed(1));
  setNum('hr', S.hr ? Math.round(S.hr) : '--');
  setNum('hrZone', lthrZone(S.hr));
  setNum('distance', (S.distance / 1000).toFixed(2));
  setNum('calories', Math.round(S.calories));
  setNum('zone', zone[0]);
  setNum('time', fmtTime(S.elapsed));

  const avgPower = S.records.length ? Math.round(S.records.reduce((sum, rec) => sum + rec.power, 0) / S.records.length) : 0;
  setNum('avgPower', avgPower);

  updateSegmentReadout();
  updateRouteReadout();
  drawChart();
  drawElevationAndPdc();
  renderSummary();
}

function attachEvents() {
  const connectBtn = getEl('trainerBtn');
  if (connectBtn) connectBtn.addEventListener('click', connectTrainer);

  const hrmBtn = getEl('hrmBtn');
  if (hrmBtn) hrmBtn.addEventListener('click', connectHrm);

  const demoBtn = getEl('demoBtn');
  if (demoBtn) demoBtn.addEventListener('click', () => {
    if (S.demo) stopDemo();
    else startDemo();
  });

  const recordBtn = getEl('recBtn');
  if (recordBtn) recordBtn.addEventListener('click', () => {
    if (S.recording) {
      stopRide();
    } else {
      startRide();
    }
  });

  const gpxBtn = getEl('gpxBtn');
  if (gpxBtn) gpxBtn.addEventListener('click', () => download(buildGPX(S.records), 'velox-ride', 'application/gpx+xml'));

  const fitBtn = getEl('fitBtn');
  if (fitBtn) fitBtn.addEventListener('click', () => download(buildFIT(S.records), 'velox-ride', 'application/octet-stream'));

  const uploadBtn = getEl('uploadCourseBtn');
  if (uploadBtn) uploadBtn.addEventListener('click', uploadCourse);

  const courseFile = getEl('courseFile');
  if (courseFile) courseFile.addEventListener('change', uploadCourse);

  const presetRoutes = getEl('presetRoutes');
  if (presetRoutes) presetRoutes.addEventListener('change', () => loadPresetRoute(presetRoutes.value));

  const clearLoopBtn = getEl('clearLoopBtn');
  if (clearLoopBtn) clearLoopBtn.addEventListener('click', clearCourse);

  const gradeToErg = getEl('gradeToErg');
  if (gradeToErg) gradeToErg.addEventListener('change', event => { S.gradeErg = event.target.checked; });

  const stravaBtn = getEl('stravaSegmentsBtn');
  if (stravaBtn) stravaBtn.addEventListener('click', loadStravaStarredSegments);

  const ftpInput = getEl('ftp');
  if (ftpInput) ftpInput.addEventListener('change', event => {
    const value = Number(event.target.value) || S.ftp;
    setState({ ftp: value });
    saveSetting('ftp', value);
  });

  const lthrInput = getEl('lthr');
  if (lthrInput) lthrInput.addEventListener('change', event => {
    const value = Number(event.target.value) || S.lthr;
    setState({ lthr: value });
    saveSetting('lthr', value);
  });

  const riderWInput = getEl('riderWeight');
  if (riderWInput) riderWInput.addEventListener('change', event => {
    const value = Math.max(35, Math.min(160, Number(event.target.value) || S.physics.riderWeightKg));
    S.physics.riderWeightKg = value;
    if (riderWInput) riderWInput.value = String(value);
    saveSetting('riderWeightKg', value);
    status('Rider weight set to ' + value + ' kg');
  });

  const ergWatts = getEl('ergWatts');
  if (ergWatts) ergWatts.addEventListener('change', event => {
    const value = Number(event.target.value) || S.ergWatts;
    setState({ ergWatts: value });
    saveSetting('ergWatts', value);
    if (S.erg) sendErg(value);
  });

  const ergToggle = getEl('ergToggle');
  if (ergToggle) ergToggle.addEventListener('click', () => {
    setState({ erg: !S.erg });
    ergToggle.textContent = S.erg ? 'ERG On' : 'ERG Off';
    if (S.erg) sendErg(S.ergWatts);
  });

  const liveServer = getEl('liveServer');
  if (liveServer) liveServer.value = LiveShare.defaultServer();

  const liveRoom = getEl('liveRoom');
  if (liveRoom) liveRoom.value = new URLSearchParams(window.location.search).get('room') || 'team-ride';

  const liveName = getEl('liveName');
  if (liveName) liveName.value = localStorage.getItem('veloxLiveName') || '';

  const liveRate = getEl('liveRate');
  if (liveRate) liveRate.addEventListener('change', event => { S.live.rateMs = Number(event.target.value) || S.live.rateMs; });

  if (liveName) liveName.addEventListener('change', event => { localStorage.setItem('veloxLiveName', event.target.value || ''); });

  const joinBtn = getEl('liveJoinBtn');
  if (joinBtn) joinBtn.addEventListener('click', () => LiveShare.join());

  const leaveBtn = getEl('liveLeaveBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', () => LiveShare.leave());

  const summaryOpen = getEl('summaryOpen');
  if (summaryOpen) summaryOpen.addEventListener('click', openSummary);
  const summaryClose = getEl('summaryClose');
  if (summaryClose) summaryClose.addEventListener('click', closeSummary);
  const summaryOverlay = getEl('summaryOverlay');
  if (summaryOverlay) summaryOverlay.addEventListener('click', event => { if (event.target === summaryOverlay) closeSummary(); });

  const rampStart = getEl('rampStart');
  if (rampStart) rampStart.addEventListener('click', startFtpRampTest);
  const rampStop = getEl('rampStop');
  if (rampStop) rampStop.addEventListener('click', stopFtpRampTest);
}

function connectFeatures() {
  Store.subscribe(() => {
    if (S.rampTest.active) updateRampTest();
    scheduleUI(updateUINow);
    LiveShare.share(false);
  });
}

function bootstrap() {
  loadPersistedSettings();
  attachEvents();
  connectFeatures();
  initFeatureUI();
  initMapillary();
  initApp();
  updateUINow();
  window.addEventListener('resize', () => {
    updateUINow();
    if (S.map) setTimeout(() => S.map.invalidateSize(), 50);
  });
}

window.addEventListener('DOMContentLoaded', bootstrap);
