// js/utils.js — shared utility helpers
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

export function fmtTime(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export function formatDuration(sec) {
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

export function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  const tenths = Math.floor((Math.max(0, ms) % 1000) / 100);
  return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + tenths;
}

export function setBusy(id, busy, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled = !!busy;
  if (label) el.textContent = label;
}
