// js/export.js — GPX/FIT ride export helpers
import { S } from './state.js';

function semicircle(deg) {
  return Math.round(deg * 2147483648 / 180);
}

function fitCRC(bytes) {
  const t = [0, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  let c = 0;
  for (const b of bytes) {
    let x = t[c & 15];
    c = (c >> 4) & 0xfff;
    c ^= x ^ t[b & 15];
    x = t[c & 15];
    c = (c >> 4) & 0xfff;
    c ^= x ^ t[(b >> 4) & 15];
  }
  return c;
}

export function buildGPX(recs) {
  const name = 'VELOX Indoor Ride';
  const pts = recs.map(r => `    <trkpt lat="${r.lat.toFixed(7)}" lon="${r.lon.toFixed(7)}"><ele>${r.ele.toFixed(1)}</ele><time>${new Date(r.time).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${r.hr || ''}</gpxtpx:hr><gpxtpx:cad>${r.cadence}</gpxtpx:cad></gpxtpx:TrackPointExtension><pwr:PowerInWatts>${r.power}</pwr:PowerInWatts></extensions></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VELOX Rider" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:pwr="http://www.garmin.com/xmlschemas/PowerExtension/v1"><metadata><name>${name}</name><time>${new Date(recs[0].time).toISOString()}</time></metadata><trk><name>${name}</name><type>cycling</type><trkseg>\n${pts}\n  </trkseg></trk></gpx>`;
}

export function buildFIT(recs) {
  const FE = 631065600;
  const u8 = v => [v & 255];
  const u16 = v => [v & 255, (v >> 8) & 255];
  const u32 = v => { v >>>= 0; return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]; };
  const s32 = v => u32(v);
  const body = [];
  const p = (...a) => a.forEach(x => body.push(...(Array.isArray(x) ? x : [x])));
  const t0 = Math.floor(recs[0].time / 1000) - FE;
  const t1 = Math.floor(recs[recs.length - 1].time / 1000) - FE;
  const elapsed = Math.max(1, t1 - t0);

  p([0x40], [0], [0], ...u16(0), [3], [0, 1, 0], [1, 2, 0x84], [4, 4, 0x86]);
  p([0], ...u8(4), ...u16(255), ...u32(t0));
  p([0x41], [0], [0], ...u16(20), [9]);
  p([253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84], [3, 1, 2], [4, 1, 2], [5, 4, 0x86], [6, 2, 0x84], [7, 2, 0x84]);
  for (const r of recs) {
    p([1], ...u32(Math.floor(r.time / 1000) - FE), ...s32(semicircle(r.lat)), ...s32(semicircle(r.lon)), ...u16(Math.round((r.ele + 500) * 5)), ...u8(r.hr || 255), ...u8(r.cadence || 255), ...u32(Math.round(r.distance * 100)), ...u16(Math.round(r.speed / 3.6 * 1000)), ...u16(r.power || 0));
  }
  p([0x42], [0], [0], ...u16(18), [8]);
  p([253, 4, 0x86], [2, 4, 0x86], [0, 1, 0], [1, 1, 0], [5, 1, 0], [6, 1, 0], [7, 4, 0x86], [9, 4, 0x86]);
  p([2], ...u32(t1), ...u32(t0), ...u8(8), ...u8(1), ...u8(2), ...u8(6), ...u32(elapsed * 1000), ...u32(Math.round(recs.at(-1).distance * 100)));
  p([0x43], [0], [0], ...u16(34), [4]);
  p([253, 4, 0x86], [0, 4, 0x86], [1, 2, 0x84], [2, 1, 0]);
  p([3], ...u32(t1), ...u32(elapsed * 1000), ...u16(1), ...u8(0));
  const hdr = [14, 16, 8, 8, ...u32(body.length), 0x2e, 0x46, 0x49, 0x54];
  const file = [...hdr, ...u16(fitCRC(hdr)), ...body];
  return new Uint8Array([...file, ...u16(fitCRC(body))]);
}

export function download(data, ext, mime) {
  const blob = new Blob([data], { type: mime });
  const a = document.createElement('a');
  const u = URL.createObjectURL(blob);
  a.href = u;
  a.download = 'velox_' + new Date(S.startMs || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.' + ext;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
