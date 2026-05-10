// js/chart.js — ride charts and visualization helpers
import { S } from './state.js';
import { zoneColor } from './physics.js';

export function downsampleHistory(values, limit) {
  if (values.length <= limit) return values;
  const out = [];
  const bucket = values.length / limit;
  for (let i = 0; i < limit; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(values.length, Math.floor((i + 1) * bucket));
    let max = 0;
    for (let j = start; j < end; j++) max = Math.max(max, values[j] || 0);
    out.push(max);
  }
  return out;
}

export function drawChart() {
  const c = document.getElementById('chart');
  if (!c) return;
  const ctx = c.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  c.width = w * dpr;
  c.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b1118';
  ctx.fillRect(0, 0, w, h);
  const pad = 26;
  const pw = w - pad - 8;
  const ph = h - pad - 8;
  const history = downsampleHistory(S.history, Math.max(60, Math.floor(pw / 2)));
  const max = Math.max(S.ftp * 1.5, 100, ...history) + 20;
  ctx.strokeStyle = '#223246';
  ctx.lineWidth = 1;
  ctx.font = '10px Consolas';
  ctx.fillStyle = '#607993';
  [0, 0.5, 1, 1.5].forEach(f => {
    const y = 8 + ph - (S.ftp * f / max) * ph;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - 8, y);
    ctx.stroke();
    ctx.fillText(Math.round(S.ftp * f), 4, y + 3);
  });
  if (history.length < 2) return;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    const den = Math.max(1, history.length - 1);
    const x1 = pad + ((i - 1) / den) * pw;
    const y1 = 8 + ph - (a / max) * ph;
    const x2 = pad + (i / den) * pw;
    const y2 = 8 + ph - (b / max) * ph;
    ctx.strokeStyle = zoneColor(b);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

export function drawElevationAndPdc() {
  const elevation = document.getElementById('elevationChart');
  if (window.drawElevationProfile && elevation) window.drawElevationProfile(elevation, S.route);
  const pdc = document.getElementById('pdcChart');
  if (window.drawPowerDurationCurve && pdc) window.drawPowerDurationCurve(pdc, S.records, S.ftp);
}
