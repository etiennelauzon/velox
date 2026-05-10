// js/segments.js — Strava starred segment matching and segment chronometer
import { S, status, setState } from './state.js';
import { setNum } from './state.js';
import { escapeHtml, fmtDuration } from './utils.js';
import { setBusy } from './utils.js';
import { getNearestRouteDistance, routeWindowAverageDistance, decodePolyline } from './route.js';

export function segmentRouteMatch(segment) {
  const start = segment.start_latlng || [];
  const end = segment.end_latlng || [];
  if (start.length < 2 || end.length < 2) return null;
  const startPoint = { lat: start[0], lon: start[1] };
  const endPoint = { lat: end[0], lon: end[1] };
  const startHit = getNearestRouteDistance(startPoint);
  const endHit = getNearestRouteDistance(endPoint);
  if (startHit.meters > 120 || endHit.meters > 120) return null;
  const proximity = Math.max(startHit.meters, endHit.meters);
  const encoded = segment.map && (segment.map.polyline || segment.map.summary_polyline);
  let avgDeviation = proximity;
  let points = [];
  if (encoded) {
    try { points = decodePolyline(encoded); } catch (e) { points = []; }
    if (points.length) avgDeviation = routeWindowAverageDistance(points, startHit.dist, endHit.dist);
  }
  const sameDirection = endHit.dist >= startHit.dist;
  const matched = proximity <= 140 && avgDeviation <= 90 && sameDirection;
  const routeLength = Math.max(1, endHit.dist - startHit.dist);
  const segmentLength = Number(segment.distance) || routeLength;
  const projectedEndDist = Math.abs(routeLength - segmentLength) > Math.max(80, segmentLength * 0.25) ? startHit.dist + segmentLength : endHit.dist;
  return { matched, startDist: startHit.dist, endDist: projectedEndDist, endPoint, startMeters: startHit.meters, endMeters: endHit.meters, avgDeviation, sameDirection };
}

export async function fetchStravaStarredSegments(token) {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const url = 'https://www.strava.com/api/v3/segments/starred?page=' + page + '&per_page=200';
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Strava HTTP ' + res.status);
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    if (batch.length < 200) break;
  }
  return all;
}

export function renderStravaSegments(matches) {
  const box = document.getElementById('stravaSegments');
  if (!box) return;
  if (!matches.length) {
    box.innerHTML = '<div class="small">No starred ride segments matched this GPX.</div>';
    return;
  }
  box.innerHTML = matches.map(({ segment, match }) => {
    const km0 = (match.startDist / 1000).toFixed(2);
    const km1 = (match.endDist / 1000).toFixed(2);
    const length = (segment.distance / 1000).toFixed(2);
    const state = S.activeSegment && S.activeSegment.id === segment.id ? ' active' : S.segmentTimes[segment.id] ? ' done' : '';
    const time = S.segmentTimes[segment.id] ? fmtDuration(S.segmentTimes[segment.id].elapsedMs) : Math.round(segment.average_grade || 0) + '%';
    return '<div class="segmentItem' + state + '"><div><b>' + escapeHtml(segment.name || 'Segment') + '</b><br><span>' + length + ' km · route km ' + km0 + '-' + km1 + ' · avg offset ' + Math.round(match.avgDeviation) + 'm</span></div><span>' + time + '</span></div>';
  }).join('');
}

export function updateSegmentReadout() {
  if (S.activeSegment) {
    setNum('segmentName', S.activeSegment.name);
    setNum('segmentTime', fmtDuration(Date.now() - S.activeSegment.startedMs));
    return;
  }
  const last = Object.values(S.segmentTimes).sort((a, b) => b.finishedMs - a.finishedMs)[0];
  if (last) {
    setNum('segmentName', last.name);
    setNum('segmentTime', fmtDuration(last.elapsedMs));
  } else {
    setNum('segmentName', 'No segment');
    setNum('segmentTime', '--:--');
  }
}

function crossedDistance(prev, next, target) {
  return prev < target && next >= target;
}

function segmentAbsDist(baseDist, currentDist) {
  if (!S.routeLen) return baseDist;
  const lap = Math.floor(currentDist / S.routeLen);
  let d = baseDist + lap * S.routeLen;
  if (d < currentDist - 5) d += S.routeLen;
  return d;
}

function finishActiveSegment(now) {
  S.segmentTimes[S.activeSegment.id] = { name: S.activeSegment.name, elapsedMs: now - S.activeSegment.startedMs, finishedMs: now };
  status('Segment finished: ' + S.activeSegment.name + ' · ' + fmtDuration(now - S.activeSegment.startedMs));
  S.activeSegment = null;
  renderStravaSegments(S.stravaSegments);
}

export function updateSegmentChronometer(prevDist, nextDist, now) {
  if (!S.stravaSegments.length || !S.routeLen) return;
  if (S.activeSegment) {
    const endAbs = S.activeSegment.endAbs;
    const routeTolerance = Math.max(18, Math.min(55, S.activeSegment.lengthM * 0.08));
    const currentPos = positionAt(nextDist);
    const geoClose = S.activeSegment.endPoint ? haversine(currentPos, S.activeSegment.endPoint) <= Math.max(45, routeTolerance * 1.5) : false;
    const farEnough = nextDist - S.activeSegment.startAbs >= Math.min(80, S.activeSegment.lengthM * 0.55);
    if (nextDist >= endAbs - routeTolerance || crossedDistance(prevDist, nextDist, endAbs) || (geoClose && farEnough)) {
      finishActiveSegment(now);
    }
  }
  if (S.activeSegment) return;
  for (const item of S.stravaSegments) {
    const id = item.segment.id;
    if (S.segmentTimes[id]) continue;
    const startAbs = segmentAbsDist(item.match.startDist, prevDist);
    if (crossedDistance(prevDist, nextDist, startAbs)) {
      const rawLength = Math.max(1, item.match.endDist - item.match.startDist);
      const lengthM = Math.max(rawLength, Number(item.segment.distance) || rawLength);
      S.activeSegment = {
        id,
        name: item.segment.name,
        startDist: item.match.startDist,
        endDist: item.match.endDist,
        startAbs,
        endAbs: startAbs + lengthM,
        lengthM,
        endPoint: item.match.endPoint,
        startedMs: now,
      };
      status('Segment started: ' + item.segment.name);
      renderStravaSegments(S.stravaSegments);
      break;
    }
  }
}

export async function loadStravaStarredSegments() {
  if (!S.routeLen) { status('Load a GPX/FIT course before matching Strava segments'); return; }
  const token = (document.getElementById('stravaToken').value || '').trim();
  if (!token) { status('Paste a Strava bearer token locally first'); return; }
  setBusy('stravaSegmentsBtn', true, 'Loading...');
  try {
    status('Loading Strava starred segments');
    const segments = await fetchStravaStarredSegments(token);
    const matches = segments
      .filter(s => s.activity_type === 'Ride')
      .map(segment => ({ segment, match: segmentRouteMatch(segment) }))
      .filter(x => x.match && x.match.matched)
      .sort((a, b) => a.match.startDist - b.match.startDist);
    S.stravaSegments = matches;
    S.activeSegment = null;
    S.segmentTimes = {};
    renderStravaSegments(matches);
    status('Matched ' + matches.length + ' of ' + segments.length + ' starred Strava segments');
  } catch (e) {
    status('Strava segments failed: ' + e.message);
  } finally {
    setBusy('stravaSegmentsBtn', false, 'Starred Segments');
  }
}

function haversine(a, b) {
  const R = 6371000;
  const p = Math.PI / 180;
  const d1 = (b.lat - a.lat) * p;
  const d2 = (b.lon - a.lon) * p;
  const x = Math.sin(d1 / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(d2 / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
