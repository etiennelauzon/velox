// js/mapillary.js — Mapillary streetview follow support
import { S } from './state.js';
import { positionAt } from './route.js';
import { getNearestRouteDistance } from './route.js';

const M = {
  enabled: true,
  token: '',
  viewer: null,
  lastImageId: null,
  lastSequenceId: null,
  lastMeta: null,
  lastScore: null,
  lastPickMs: 0,
  sequenceBuffer: [],
  preload: [],
  moving: false,
  refreshMs: 2000,
  radiusM: 60,
  maxCandidates: 30,
  passEpsilonM: 3,
};

function setMlyStatus(txt) {
  const el = document.getElementById('mlyStatus');
  if (el) el.textContent = txt;
}

function showFallback(on) {
  const f = document.getElementById('mlyFallback');
  if (!f) return;
  f.classList.toggle('hidden', !on);
}

function rad(d) { return d * Math.PI / 180; }
function deg(r) { return r * 180 / Math.PI; }

function bearing(a, b) {
  const phi1 = rad(a.lat);
  const phi2 = rad(b.lat);
  const dLam = rad(b.lon - a.lon);
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function angDiff(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 180;
  return Math.abs(((a - b + 540) % 360) - 180);
}

function bboxAround(p, rM) {
  const lat = p.lat;
  const lon = p.lon;
  const dLat = rM / 111320;
  const dLon = rM / (111320 * Math.max(0.2, Math.cos(rad(lat))));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

function routeDistanceForPoint(pt) {
  return getNearestRouteDistance(pt).dist;
}

function unwrapRouteDist(dist, current) {
  if (!S.routeLen) return dist;
  let d = dist;
  while (d < current - M.radiusM) d += S.routeLen;
  while (d > current + S.routeLen - M.radiusM) d -= S.routeLen;
  return d;
}

function routeBearingAt(dist) {
  const a = positionAt(dist - 8);
  const b = positionAt(dist + 18);
  return bearing({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
}

async function mlyFetch(url) {
  const res = await fetch(url, { headers: { 'Authorization': 'OAuth ' + M.token } });
  if (!res.ok) throw new Error('Mapillary HTTP ' + res.status);
  return await res.json();
}

async function loadSequenceImages(pos, travelBrg) {
  const bbox = bboxAround(pos, M.radiusM);
  const url = 'https://graph.mapillary.com/images?fields=id&bbox=' + bbox.join(',') + '&limit=80';
  const data = await mlyFetch(url);
  const ids = (data && data.data ? data.data.map(x => x.id).filter(Boolean) : []);
  if (!ids.length) return [];
  const take = ids.slice(0, M.maxCandidates);
  const metas = await Promise.all(take.map(async id => {
    try {
      return await mlyFetch('https://graph.mapillary.com/' + id + '?fields=id,geometry,compass_angle,computed_compass_angle,sequence,thumb_1024_url');
    } catch (e) {
      return null;
    }
  }));
  const frames = [];
  for (const meta of metas) {
    if (!meta) continue;
    const g = meta.geometry || meta.computed_geometry;
    if (!g || !g.coordinates || g.coordinates.length < 2) continue;
    const lon = g.coordinates[0];
    const lat = g.coordinates[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const d = haversine({ lat: pos.lat, lon: pos.lon }, { lat, lon });
    const routeDist = unwrapRouteDist(routeDistanceForPoint({ lat, lon }), S.routeDistance);
    const aheadM = routeDist - S.routeDistance;
    const compass = Number.isFinite(meta.compass_angle) ? meta.compass_angle : meta.computed_compass_angle;
    const ca = Number.isFinite(compass) ? compass : NaN;
    const localBrg = routeBearingAt(routeDist);
    const ad = Number.isFinite(ca) ? Math.min(angDiff(travelBrg, ca), angDiff(localBrg, ca)) : 180;
    let score = d + Math.max(0, aheadM) * 0.08 + (Number.isFinite(ca) ? ad * 2.4 : 160) + (aheadM < -8 ? 120 : 0);
    const sid = seqId(meta);
    if (M.lastSequenceId && sid && sid === M.lastSequenceId) score -= 22;
    if (d > M.radiusM * 1.8 || ad > 72 || aheadM < -14) continue;
    frames.push({ id: meta.id, meta, pt: { lat, lon }, seq: sid, dist: d, angleDiff: ad, score, routeDist });
  }
  frames.sort((a, b) => (a.routeDist - b.routeDist) || (a.score - b.score));
  const dedup = [];
  for (const frame of frames) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.abs(prev.routeDist - frame.routeDist) < 2) {
      if (frame.score < prev.score) dedup[dedup.length - 1] = frame;
    } else {
      dedup.push(frame);
    }
  }
  return dedup;
}

function getNextImageFromSequence(routeDist) {
  if (!M.sequenceBuffer.length) return null;
  const passed = M.sequenceBuffer.filter(f => f.routeDist <= routeDist + M.passEpsilonM);
  let next = passed.length ? passed[passed.length - 1] : M.sequenceBuffer[0];
  if (M.lastImageId && next.id === M.lastImageId) return null;
  return next;
}

function preloadImageBuffer(frame) {
  const start = Math.max(0, M.sequenceBuffer.findIndex(f => frame && f.id === frame.id));
  M.preload = M.sequenceBuffer.slice(start + 1, start + 6).map(f => {
    if (!f.meta.thumb_1024_url) return null;
    const img = new Image();
    img.decoding = 'async';
    img.src = f.meta.thumb_1024_url;
    return img;
  }).filter(Boolean);
}

async function updateImageFrame(frame) {
  if (!frame || frame.id === M.lastImageId || M.moving) return;
  M.moving = true;
  const el = document.getElementById('mly');
  try {
    if (el) el.style.opacity = '0.72';
    setMlyStatus('-> image ' + frame.id + ' (' + Math.round(frame.dist) + 'm)');
    await M.viewer.moveTo(frame.id);
    M.lastImageId = frame.id;
    M.lastSequenceId = frame.seq || M.lastSequenceId;
    M.lastMeta = frame.meta;
    M.lastScore = frame.score;
    preloadImageBuffer(frame);
    showFallback(false);
  } finally {
    if (el) el.style.opacity = '1';
    M.moving = false;
  }
}

export async function updateStreetview(pos, travelBrg) {
  if (!M.enabled) {
    setMlyStatus('Inactive');
    showFallback(true);
    return;
  }
  if (!M.token) { setMlyStatus('Token requis'); return; }
  if (!window.mapillary || !window.mapillary.Viewer) { setMlyStatus('MapillaryJS en chargement…'); return; }
  if (!M.viewer) {
    try {
      M.viewer = new window.mapillary.Viewer({ accessToken: M.token, container: 'mly', component: { cover: false } });
      setMlyStatus('Prêt');
    } catch (e) {
      setMlyStatus('Erreur init: ' + e.message);
      return;
    }
  }
  const now = Date.now();
  const shouldRefresh = now - M.lastPickMs >= M.refreshMs - 30;
  try {
    if (shouldRefresh) {
      M.lastPickMs = now;
      const frames = await loadSequenceImages(pos, travelBrg);
      const byId = new Map([...M.sequenceBuffer, ...frames].map(f => [f.id, { ...f, routeDist: unwrapRouteDist(f.routeDist, S.routeDistance) }]));
      M.sequenceBuffer = Array.from(byId.values())
        .filter(f => f.routeDist >= S.routeDistance - 14 && f.routeDist - S.routeDistance < Math.max(120, M.radiusM * 2.5))
        .sort((a, b) => (a.routeDist - b.routeDist) || (a.score - b.score));
    }
    if (!M.sequenceBuffer.length) {
      setMlyStatus('No nearby image');
      showFallback(true);
      return;
    }
    const next = getNextImageFromSequence(S.routeDistance);
    if (next) await updateImageFrame(next);
    else if (M.lastImageId) setMlyStatus('OK (buffer ' + M.sequenceBuffer.length + ')');
  } catch (e) {
    setMlyStatus('API error: ' + e.message);
    showFallback(true);
  }
}

function seqId(meta) {
  const s = meta.sequence;
  if (!s) return null;
  if (typeof s === 'string' || typeof s === 'number') return String(s);
  if (typeof s === 'object' && s.id) return String(s.id);
  return null;
}

function haversine(a, b) {
  const R = 6371000;
  const p = Math.PI / 180;
  const d1 = (b.lat - a.lat) * p;
  const d2 = (b.lon - a.lon) * p;
  const x = Math.sin(d1 / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(d2 / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function wireUI() {
  const enable = document.getElementById('mlyEnable');
  const token = document.getElementById('mlyToken');
  const refresh = document.getElementById('mlyRefresh');
  const radius = document.getElementById('mlyRadius');
  if (enable) enable.onchange = e => { M.enabled = !!e.target.checked; setMlyStatus(M.enabled ? 'Prêt' : 'Inactif'); showFallback(!M.enabled); };
  if (token) {
    token.onchange = e => {
      M.token = (e.target.value || '').trim();
      M.viewer = null; M.lastImageId = null; M.lastSequenceId = null; M.lastMeta = null; M.lastScore = null; M.sequenceBuffer = []; M.preload = [];
      setMlyStatus(M.token ? 'Token chargé' : 'Token requis');
      showFallback(!M.token);
    };
    token.oninput = e => { if ((e.target.value || '').includes('MLY|')) token.onchange(e); };
  }
  if (refresh) refresh.onchange = e => { M.refreshMs = parseInt(e.target.value, 10) || 2000; };
  if (radius) radius.onchange = e => { M.radiusM = parseInt(e.target.value, 10) || 60; M.sequenceBuffer = []; };
}

export function initMapillary() {
  wireUI();
}

export function showMapillaryPanel(show) {
  const wrap = document.getElementById('mlyWrap');
  if (!wrap) return;
  wrap.classList.toggle('hidden', !show);
}
