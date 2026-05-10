// js/route.js — route parsing, GPX/FIT support, and map route navigation
import { S, setState, status } from './state.js';
import { clamp } from './physics.js';
import { setNum } from './state.js';
import { setBusy } from './utils.js';

function haversine(a, b) {
  const R = 6371000,
    p = Math.PI / 180,
    d1 = (b.lat - a.lat) * p,
    d2 = (b.lon - a.lon) * p,
    x = Math.sin(d1 / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(d2 / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 + x));
}

function finalizeRoute(points, name) {
  if (points.length < 2) throw new Error('Course needs at least two GPS points');
  let total = 0,
    climb = 0,
    prev = null;
  S.route = points.map((p, i) => {
    const point = { lat: p.lat, lon: p.lon, ele: Number.isFinite(p.ele) ? p.ele : 0, dist: 0, grade: 0 };
    if (prev) {
      total += haversine(prev, point);
      point.dist = total;
      const rise = point.ele - prev.ele;
      if (rise > 0) climb += rise;
      const dd = Math.max(1, point.dist - prev.dist);
      point.grade = clamp(rise / dd * 100, -20, 20);
    }
    prev = point;
    return point;
  });
  S.routeLen = total;
  S.route.forEach(point => {
    point.smoothedGrade = getSmoothedGradeFromGPX(point.dist, S.physics.gradeWindowM);
  });
  S.routeName = name || 'Uploaded course';
  S.routeDistance = 0;
  S.vMps = 0;
  S.speed = 0;
  S.stravaSegments = [];
  S.activeSegment = null;
  S.segmentTimes = {};
  const segContainer = document.getElementById('stravaSegments');
  if (segContainer) segContainer.innerHTML = '';
  setNum('lapDist', (total / 1000).toFixed(1));
  setNum('lapElev', Math.round(climb));
  const note = document.getElementById('courseNote');
  if (note) note.textContent = 'Loaded ' + S.routeName + ' from file. Demo/live speed now moves along this actual uploaded track.';
  drawRoute();
  status('Course loaded: ' + S.routeName + ' · ' + (total / 1000).toFixed(1) + ' km');
}

function textOf(node, name) {
  const found = Array.from(node.getElementsByTagName('*')).find(x => x.localName === name);
  return found ? found.textContent : '';
}

export function parseGpx(text, name) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid GPX XML');
  const pts = Array.from(doc.getElementsByTagName('trkpt')).map(n => ({
    lat: Number(n.getAttribute('lat')),
    lon: Number(n.getAttribute('lon')),
    ele: Number(textOf(n, 'ele')) || 0,
  })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const trkName = textOf(doc, 'name') || name;
  finalizeRoute(pts, trkName);
}

function readFitValue(view, offset, size, type, little) {
  const base = type & 31;
  if (size === 1) return view.getUint8(offset);
  if (size === 2) return base === 0x03 ? view.getInt16(offset, little) : view.getUint16(offset, little);
  if (size === 4) return base === 0x05 ? view.getInt32(offset, little) : view.getUint32(offset, little);
  return null;
}

export function parseFit(buf, name) {
  const view = new DataView(buf),
    header = view.getUint8(0),
    dataSize = view.getUint32(4, true),
    end = header + dataSize,
    defs = {},
    pts = [];
  let off = header;
  while (off < end) {
    const h = view.getUint8(off++);
    const local = (h & 0x80) ? ((h >> 5) & 3) : (h & 15);
    if (h & 0x40) {
      off++;
      const little = view.getUint8(off++) === 0;
      const global = view.getUint16(off, little);
      off += 2;
      const count = view.getUint8(off++);
      const fields = [];
      for (let i = 0; i < count; i++) fields.push({ num: view.getUint8(off++), size: view.getUint8(off++), type: view.getUint8(off++) });
      if (h & 0x20) { const dc = view.getUint8(off++); off += dc * 3; }
      defs[local] = { global, fields, little };
      continue;
    }
    const def = defs[local];
    if (!def) break;
    const start = off,
      rec = {};
    for (const f of def.fields) {
      if (def.global === 20) rec[f.num] = readFitValue(view, off, f.size, f.type, def.little);
      off += f.size;
    }
    if (def.global === 20 && Number.isFinite(rec[0]) && Number.isFinite(rec[1]) && Math.abs(rec[0]) < 0x7fffffff && Math.abs(rec[1]) < 0x7fffffff) {
      pts.push({
        lat: rec[0] * 180 / 2147483648,
        lon: rec[1] * 180 / 2147483648,
        ele: Number.isFinite(rec[2]) ? rec[2] / 5 - 500 : 0,
      });
    }
    if (off <= start) break;
  }
  finalizeRoute(pts, name.replace(/\.fit$/i, ''));
}

export async function uploadCourse() {
  const file = document.getElementById('courseFile').files[0];
  if (!file) { status('Choose a GPX or FIT file first'); return; }
  setBusy('uploadCourseBtn', true, 'Loading...');
  const note = document.getElementById('courseNote');
  if (note) note.textContent = 'Loading ' + file.name + '...';
  try {
    if (file.name.toLowerCase().endsWith('.gpx')) {
      parseGpx(await file.text(), file.name.replace(/\.gpx$/i, ''));
      return true;
    } else if (file.name.toLowerCase().endsWith('.fit')) {
      parseFit(await file.arrayBuffer(), file.name);
      return true;
    } else {
      status('Unsupported course file. Use GPX or FIT.');
      return false;
    }
  } catch (e) {
    if (note) note.textContent = 'Course load failed: ' + e.message;
    status('Course load failed: ' + e.message);
    return false;
  } finally {
    setBusy('uploadCourseBtn', false, 'Upload Course');
  }
}

export async function loadPresetRoute() {
  const val = document.getElementById('presetRoutes').value;
  if (!val) return;
  status('Loading preset route...');
  try {
    const response = await fetch('routes/' + val + '.gpx');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    parseGpx(text, val.toUpperCase() + ' Route');
    status('Loaded preset route: ' + val);
    return true;
  } catch (e) {
    status('Failed to load preset: ' + e.message);
    return false;
  }
}

export function positionAt(dist) {
  if (!S.routeLen || !S.route.length) return { lat: 0, lon: 0, ele: 0, grade: 0 };
  const d = dist % S.routeLen;
  let i = 1;
  while (i < S.route.length && S.route[i].dist < d) i++;
  const a = S.route[i - 1] || S.route[0],
    b = S.route[i] || S.route[0],
    span = Math.max(1, b.dist - a.dist),
    t = clamp((d - a.dist) / span, 0, 1);
  const grade = Number.isFinite(a.smoothedGrade) && Number.isFinite(b.smoothedGrade)
    ? a.smoothedGrade + (b.smoothedGrade - a.smoothedGrade) * t
    : (b.grade || 0);
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    ele: a.ele + (b.ele - a.ele) * t,
    grade,
  };
}

export function updateRouteReadout() {
  const p = positionAt(S.routeDistance);
  const grade = getSmoothedGradeFromGPX(S.routeDistance, S.physics.gradeWindowM);
  setNum('gradeNow', (grade || 0).toFixed(1) + '%');
  setNum('laps', S.routeLen ? Math.floor(S.routeDistance / S.routeLen) : 0);
  if (S.map && S.routeLen) {
    if (!S.rider) S.rider = L.circleMarker([p.lat, p.lon], { radius: 7, color: '#19d3ef', fillColor: '#19d3ef', fillOpacity: 1 }).addTo(S.map);
    else S.rider.setLatLng([p.lat, p.lon]);
  }
  updateLivePeerMarkers();
}

function liveIcon(peer) {
  return L.divIcon({
    className: 'live-peer-icon',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${peer.color};border:2px solid white;"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export function updateLivePeerMarkers() {
  if (!S.map || !window.L) return;
  const now = Date.now();
  for (const [peerId, peer] of Object.entries(S.live.peers)) {
    if (!Number.isFinite(peer.lat) || !Number.isFinite(peer.lon)) continue;
    peer.lastSeen = now;
    let marker = S.live.markers.get(peerId);
    if (!marker) {
      marker = L.marker([peer.lat, peer.lon], { icon: liveIcon(peer) }).addTo(S.map);
      S.live.markers.set(peerId, marker);
    } else {
      marker.setLatLng([peer.lat, peer.lon]);
      marker.setIcon(liveIcon(peer));
    }
  }
  for (const peerId of Array.from(S.live.markers.keys())) {
    if (!S.live.peers[peerId]) {
      const marker = S.live.markers.get(peerId);
      if (marker) marker.remove();
      S.live.markers.delete(peerId);
    }
  }
}

export function drawRoute() {
  if (!window.L) { status('Map library is still loading. Try Upload Course again in a moment.'); return; }
  const courseEmpty = document.getElementById('courseEmpty');
  if (courseEmpty) courseEmpty.classList.add('hidden');
  const mapEl = document.getElementById('map');
  if (mapEl) mapEl.classList.remove('hidden');
  if (!S.map) S.map = L.map('map', { zoomControl: true }).setView([45.5019, -73.5674], 13);
  setMapTile(S.mapTile || 'osm');
  if (S.line) S.line.remove();
  if (S.rider) S.rider.remove();
  S.rider = null;
  const latlng = S.route.map(p => [p.lat, p.lon]);
  S.line = L.polyline(latlng, { color: '#19d3ef', weight: 4 }).addTo(S.map);
  S.map.fitBounds(S.line.getBounds(), { padding: [20, 20] });
  setTimeout(() => {
    S.map.invalidateSize();
    S.map.fitBounds(S.line.getBounds(), { padding: [20, 20] });
    updateRouteReadout();
  }, 60);
}

export function setMapTile(type) {
  if (!S.map || !window.L) return;
  const layerUrl = window.getTileUrl ? window.getTileUrl(type) : (type === 'satellite'
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
  const attribution = type === 'satellite' ? 'Esri Satellite' : 'OpenStreetMap';
  if (S.mapTileLayer) S.map.removeLayer(S.mapTileLayer);
  S.mapTileLayer = L.tileLayer(layerUrl, { maxZoom: 19, attribution });
  S.mapTileLayer.addTo(S.map);
  setState({ mapTile: type });
}

export function clearCourse() {
  S.route = [];
  S.routeLen = 0;
  S.routeDistance = 0;
  S.vMps = 0;
  S.speed = 0;
  S.routeName = 'No course';
  S.stravaSegments = [];
  S.activeSegment = null;
  S.segmentTimes = {};
  if (S.line) S.line.remove();
  if (S.rider) S.rider.remove();
  S.rider = null;
  if (S.live) S.live.markers.forEach(marker => marker.remove());
  if (S.live) S.live.markers.clear();
  if (S.live && S.live.webRTCpeers) {
    S.live.webRTCpeers.forEach(p => p.destroy());
    S.live.webRTCpeers.clear();
  }
  const mapEl = document.getElementById('map');
  if (mapEl) mapEl.classList.add('hidden');
  const courseEmpty = document.getElementById('courseEmpty');
  if (courseEmpty) courseEmpty.classList.remove('hidden');
  setNum('lapDist', '0.0');
  setNum('lapElev', '0');
  setNum('gradeNow', '0.0%');
  setNum('laps', '0');
  setNum('segmentTime', '--:--');
  setNum('segmentName', 'No segment');
  const segContainer = document.getElementById('stravaSegments');
  if (segContainer) segContainer.innerHTML = '';
  const note = document.getElementById('courseNote');
  if (note) note.textContent = 'Upload a GPX/FIT course to ride the real track.';
  status('Course cleared');
}

export function decodePolyline(str) {
  let index = 0,
    lat = 0,
    lng = 0,
    points = [];
  while (index < str.length) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push({ lat: lat / 1e5, lon: lng / 1e5 });
  }
  return points;
}

let routeLoadTimeout = null;

export function getSmoothedGradeFromGPX(dist, windowM) {
  if (!S.routeLen || S.route.length < 2) return 0;
  const span = clamp(windowM || S.physics.gradeWindowM, 20, 220);
  const back = positionAt(dist - span / 2);
  const ahead = positionAt(dist + span / 2);
  const run = Math.max(1, haversine(back, ahead));
  const grade = (ahead.ele - back.ele) / run * 100;
  return Number.isFinite(grade) ? clamp(grade, -20, 20) : 0;
}

export function setMapTileLayer(type) {
  return setMapTile(type);
}

export function getNearestRouteDistance(pt) {
  if (!S.routeLen || !S.route.length) return { dist: 0, meters: Infinity };
  let best = { dist: 0, meters: Infinity };
  const lat0 = pt.lat * Math.PI / 180,
    mPerLat = 111320,
    mPerLon = 111320 * Math.max(0.2, Math.cos(lat0));
  for (let i = 1; i < S.route.length; i++) {
    const a = S.route[i - 1],
      b = S.route[i],
      ax = (a.lon - pt.lon) * mPerLon,
      ay = (a.lat - pt.lat) * mPerLat,
      bx = (b.lon - pt.lon) * mPerLon,
      by = (b.lat - pt.lat) * mPerLat,
      vx = bx - ax,
      vy = by - ay,
      len2 = Math.max(1, vx * vx + vy * vy),
      t = clamp(-(ax * vx + ay * vy) / len2, 0, 1),
      x = ax + vx * t,
      y = ay + vy * t,
      meters = Math.sqrt(x * x + y * y);
    if (meters < best.meters) best = { dist: a.dist + (b.dist - a.dist) * t, meters };
  }
  return best;
}

export function matchRouteSegment(segment) {
  const start = segment.start_latlng || [],
    end = segment.end_latlng || [];
  if (start.length < 2 || end.length < 2) return null;
  const startPoint = { lat: start[0], lon: start[1] },
    endPoint = { lat: end[0], lon: end[1] };
  const startHit = getNearestRouteDistance(startPoint);
  const endHit = getNearestRouteDistance(endPoint);
  if (startHit.meters > 120 || endHit.meters > 120) return null;
  const segmentDistance = endHit.dist - startHit.dist;
  const segmentName = segment.name || 'Segment';
  return { name: segmentName, start: startHit.dist, end: endHit.dist, length: segmentDistance, id: segment.id };
}

export function updateRouteReadoutAfterLoad() {
  if (routeLoadTimeout) clearTimeout(routeLoadTimeout);
  routeLoadTimeout = setTimeout(updateRouteReadout, 60);
}
