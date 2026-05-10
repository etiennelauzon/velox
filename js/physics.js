// js/physics.js — bike physics engine and utility functions
import { S } from './state.js';

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function fmtTime(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export function powerZone(w) {
  const p = (w / S.ftp) * 100;
  if (p < 55) return ['Z1 Recovery', 'var(--blue)', p];
  if (p < 76) return ['Z2 Endurance', 'var(--green)', p];
  if (p < 88) return ['Z3 Tempo', 'var(--yellow)', p];
  if (p < 101) return ['Z4 Threshold', 'var(--orange)', p];
  if (p < 120) return ['Z5 VO2 Max', 'var(--red)', p];
  if (p < 151) return ['Z6 Anaerobic', 'var(--mag)', p];
  return ['Z7 Sprint', 'var(--cyan)', p];
}

export function zoneColor(w) {
  const p = (w / S.ftp) * 100;
  if (p < 55) return '#5d8cff';
  if (p < 76) return '#44d07b';
  if (p < 88) return '#e9c54a';
  if (p < 101) return '#ff8738';
  if (p < 120) return '#ef4d4d';
  if (p < 151) return '#c65cff';
  return '#19d3ef';
}

export function lthrZone(hr) {
  if (!hr) return '--';
  const p = (hr / S.lthr) * 100;
  if (p < 81) return 'Z1';
  if (p < 89) return 'Z2';
  if (p < 94) return 'Z3';
  if (p < 100) return 'Z4';
  if (p < 106) return 'Z5a';
  return 'Z5b';
}

export const PhysicsEngine = {
  totalSystemMassKg(cfg) {
    return cfg.riderWeightKg + cfg.bikeWeightKg;
  },
  solveSpeedFromPower(powerW, gradePct, cfg) {
    const mass = this.totalSystemMassKg(cfg);
    const p = Math.max(0, Number(powerW) || 0) * cfg.drivetrainEfficiency;
    const grade = clamp((Number(gradePct) || 0) / 100, -0.25, 0.25);
    const aero = 0.5 * cfg.rho * cfg.cda;
    const rolling = cfg.crr * mass * cfg.g;
    const slope = mass * cfg.g * grade;
    let lo = cfg.minTargetMps,
      hi = cfg.maxTargetMps;
    const wattsAt = v => aero * v * v * v + (rolling + slope) * v;
    while (wattsAt(hi) < p && hi < 60) hi *= 1.25;
    for (let i = 0; i < 34; i++) {
      const mid = (lo + hi) / 2;
      if (wattsAt(mid) > p) hi = mid;
      else lo = mid;
    }
    const v = clamp((lo + hi) / 2, cfg.minTargetMps, cfg.maxTargetMps);
    return Number.isFinite(v) ? v : cfg.minTargetMps;
  },
  smoothSpeed(currentMps, targetMps, dt, cfg) {
    const cur = Number.isFinite(currentMps) ? Math.max(0, currentMps) : 0;
    const target = Number.isFinite(targetMps) ? Math.max(cfg.minTargetMps, targetMps) : cfg.minTargetMps;
    const alpha = clamp(dt / (Math.max(0.1, cfg.tau) + dt), 0, 1);
    const v = cur + alpha * (target - cur);
    return Number.isFinite(v) ? Math.max(0, v) : cfg.minTargetMps;
  },
};

export function totalSystemMassKg() {
  return PhysicsEngine.totalSystemMassKg(S.physics);
}

export function solveSpeedFromPower(powerW, gradePct) {
  return PhysicsEngine.solveSpeedFromPower(powerW, gradePct, S.physics);
}

export function smoothSpeed(currentMps, targetMps, dt) {
  return PhysicsEngine.smoothSpeed(currentMps, targetMps, dt, S.physics);
}

// Note: getSmoothedGradeFromGPX and stepSimulation depend on positionAt and haversine from gpx.js
// They are imported in gpx.js's simulation module or rider.js
