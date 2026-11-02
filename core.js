'use strict';
/* Agenda Trajets - core: data, helpers, Google APIs, trips, PIN */
const VERSION = '1.1.0-ors';
const LS_DATA = 'ators_data', LS_PIN = 'ators_pin', LS_META = 'ators_meta'; /* own keys: never mixes with the Google version hosted on the same domain */

/* ---------- data ---------- */
function defaultLang() { return (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en'; }
function defaultDB() {
  return { v: 1, places: [], appts: [], days: {}, routes: {},
    settings: { lang: defaultLang(), homeId: null, autoReturn: true, rate: 0, currency: '$', apiKey: '', region: 'lb',
      lockMin: 1, backupFreq: 'never', lastBackup: null } };
}
let DB = defaultDB();
function loadDB() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) { const d = JSON.parse(raw), def = defaultDB(); DB = Object.assign(def, d); DB.settings = Object.assign(def.settings, d.settings || {}); }
    else DB = defaultDB();
  } catch (e) { DB = defaultDB(); }
}
function saveDB() {
  try { localStorage.setItem(LS_DATA, JSON.stringify(DB)); return true; }
  catch (e) { toast(t('quotaError'), true); return false; }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const S = () => DB.settings;
const place = id => DB.places.find(p => p.id === id) || null;

/* ---------- i18n + formatting ---------- */
function t(key, params) {
  let s = (I18N[S().lang] && I18N[S().lang][key]);
  if (s === undefined) s = I18N.fr[key];
  if (s === undefined) return key;
  if (params && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => params[k] !== undefined ? params[k] : '');
  return s;
}
const locale = () => S().lang === 'fr' ? 'fr-FR' : 'en-GB';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const addMonths = (s, n) => { const d = parseYmd(s); d.setDate(1); d.setMonth(d.getMonth() + n); return ymd(d); };
const mondayOf = s => { const d = parseYmd(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return ymd(d); };
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const fromMin = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
function fmtDate(s, opts) { return parseYmd(s).toLocaleDateString(locale(), opts || { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function fmtKm(n) { return n == null ? '—' : n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function fmtMoney(n) { const c = S().currency || ''; const v = n.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return S().lang === 'fr' ? v + ' ' + c : c + v; }
function fmtDur(min) { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? h + ' h ' + pad(m) : h + ' h') : m + ' min'; }
function fmtSize(b) { return b < 1024 ? b + ' o' : b < 1048576 ? (b / 1024).toFixed(0) + ' Ko' : (b / 1048576).toFixed(1) + ' Mo'; }
const round1 = n => Math.round(n * 10) / 10;

/* ---------- OpenRouteService (HeiGIT) REST APIs, user's own key ---------- */
const ORS_BASE = 'https://api.heigit.org';
class ApiError extends Error { constructor(code, detail, api) { super(code); this.code = code; this.detail = detail; this.api = api; } }
function apiMessage(e) {
  if (!(e instanceof ApiError)) return t('error', { m: e && e.message || e });
  switch (e.code) {
    case 'key': return t('apiErrKey');
    case 'denied': return t('apiErrDenied', { api: e.api || 'OpenRouteService' });
    case 'quota': return t('apiErrQuota');
    case 'net': return t('apiErrNet');
    case 'noroute': return t('apiErrNoRoute');
    case 'toofar': return t('apiErrTooFar');
    default: return t('apiErrOther', { m: e.detail || '' });
  }
}
/* All calls are plain GETs with the key in the query string: no custom headers, so the browser sends no CORS preflight. */
async function orsGet(api, path, params) {
  if (!S().apiKey) throw new ApiError('key');
  const url = ORS_BASE + path + '?' + new URLSearchParams(Object.assign({ api_key: S().apiKey }, params)).toString();
  let res;
  try { res = await fetch(url); } catch (e) { throw new ApiError('net'); }
  if (!res.ok) {
    let j = null; try { j = await res.json(); } catch (e) { /* ignore */ }
    const err = j && (j.error || (j.geocoding && j.geocoding.errors && { message: j.geocoding.errors.join(' ') }));
    const code = err && typeof err === 'object' ? err.code : null, msg = err && typeof err === 'object' ? err.message : (typeof err === 'string' ? err : '');
    if (res.status === 401 || res.status === 403) throw new ApiError('denied', msg, api);
    if (res.status === 429) throw new ApiError('quota', msg, api);
    if (code === 2010 || code === 2009) throw new ApiError('noroute', msg, api);
    if (code === 2004) throw new ApiError('toofar', msg, api);
    throw new ApiError('other', msg || ('HTTP ' + res.status), api);
  }
  return res.json();
}
const acCache = new Map();
async function placesAutocomplete(input) {
  const q = input.trim(), ck = (S().region || '') + '|' + S().lang + '|' + q.toLowerCase();
  if (acCache.has(ck)) return acCache.get(ck);
  const params = { text: q, size: 6 };
  if (S().region) params['boundary.country'] = S().region.toUpperCase();
  const j = await orsGet('Geocoding', '/pelias/v1/autocomplete', params);
  const out = (j.features || []).filter(f => f.geometry && f.geometry.coordinates).map(f => {
    const p = f.properties || {}, name = p.name || p.label || '', label = p.label || name;
    const secondary = label.startsWith(name) ? label.slice(name.length).replace(/^[,\s]+/, '') : label;
    return { gid: p.gid || p.id || null, main: name, secondary, address: label, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
  });
  acCache.set(ck, out);
  return out;
}
async function computeRoute(a, b) {
  const j = await orsGet('Directions', '/openrouteservice/v2/directions/driving-car', { start: a.lng + ',' + a.lat, end: b.lng + ',' + b.lat });
  const f = j.features && j.features[0], r = j.routes && j.routes[0];
  const m = f ? f.properties && f.properties.summary && f.properties.summary.distance : r && r.summary && r.summary.distance;
  if (typeof m !== 'number') throw new ApiError('noroute');
  return round1(m / 1000);
}
async function reverseGeocode(lat, lng) {
  const j = await orsGet('Geocoding', '/pelias/v1/reverse', { 'point.lat': lat, 'point.lon': lng, size: 1 });
  const f = j.features && j.features[0];
  return f && f.properties ? (f.properties.label || f.properties.name || '') : '';
}
/* Parse coordinates from text or from a long Google Maps link. Returns {lat,lng} | 'short' | null */
function parseCoords(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(s)) return 'short';
  const ok = (la, lo) => la >= -90 && la <= 90 && lo >= -180 && lo <= 180 ? { lat: la, lng: lo } : null;
  let m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  m = s.match(/(?:[?&](?:q|ll|query|destination)=)(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return ok(+m[1], +m[2]);
  m = s.match(/^\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?$/);
  if (m) return ok(+m[1], +m[2]);
  return null;
}
const mapsPlaceUrl = p => p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address || p.name)}`;
const mapsDirUrl = (a, b) => {
  const o = a.lat != null ? `${a.lat},${a.lng}` : (a.address || a.name), d = b.lat != null ? `${b.lat},${b.lng}` : (b.address || b.name);
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=driving`;
};

/* ---------- distances & trips ---------- */
const hasCoords = p => p && p.lat != null && p.lng != null;
async function routeKm(fromId, toId, force) {
  if (!fromId || !toId) return null;
  if (fromId === toId) return 0;
  const a = place(fromId), b = place(toId);
  if (!a || !b || !hasCoords(a) || !hasCoords(b)) return null;
  const key = fromId + '>' + toId;
  if (!force && DB.routes[key] != null) return DB.routes[key];
  const km = await computeRoute(a, b);
  DB.routes[key] = km; saveDB();
  return km;
}
function cachedKm(fromId, toId) {
  if (!fromId || !toId) return null;
  if (fromId === toId) return 0;
  const v = DB.routes[fromId + '>' + toId];
  return v == null ? null : v;
}
function invalidateRoutes(placeId) {
  Object.keys(DB.routes).forEach(k => { const [a, b] = k.split('>'); if (a === placeId || b === placeId) delete DB.routes[k]; });
  DB.appts.forEach(a => { if (!a.kmManual && (a.fromId === placeId || a.toId === placeId)) a.km = null; });
  Object.values(DB.days).forEach(d => { if (!d.kmManual) d.km = null; });
}
const apptSort = (a, b) => (a.date + a.start + a.end).localeCompare(b.date + b.start + b.end);
function apptsOn(date, includeCancelled) { return DB.appts.filter(a => a.date === date && (includeCancelled || a.status !== 'cancelled')).sort(apptSort); }
function placeName(id, snap) { const p = place(id); return p ? p.name : (snap || '?'); }
/* Single return-home trip for a day (derived). null when no return applies. */
function returnTrip(date, list) {
  if (!S().autoReturn) return null;
  list = list || apptsOn(date);
  if (!list.length) return null;
  const day = DB.days[date] || {};
  const home = place(S().homeId);
  if (!home) return { date, needsHome: true };
  if (day.off) return { date, off: true, toId: home.id };
  let last = list[0];
  list.forEach(a => { if (a.end > last.end || (a.end === last.end && a.start >= last.start)) last = a; });
  const fromId = day.fromId && place(day.fromId) ? day.fromId : last.toId;
  const manual = !!day.kmManual && day.km != null;
  const km = manual ? day.km : cachedKm(fromId, home.id);
  return { date, kind: 'return', fromId, fromName: placeName(fromId, last.toName), toId: home.id, toName: home.name, km, manual, start: last.end, end: last.end, auto: !day.fromId };
}
/* All counted trips between two dates (inclusive), sorted. */
function tripsInRange(from, to) {
  const byDate = {};
  DB.appts.forEach(a => { if (a.status !== 'cancelled' && a.date >= from && a.date <= to) (byDate[a.date] = byDate[a.date] || []).push(a); });
  const out = [];
  Object.keys(byDate).sort().forEach(date => {
    const list = byDate[date].sort(apptSort);
    list.forEach(a => out.push({ kind: 'appt', id: a.id, date, start: a.start, end: a.end, title: a.title || '', fromId: a.fromId, toId: a.toId,
      fromName: placeName(a.fromId, a.fromName), toName: placeName(a.toId, a.toName), km: a.km, status: a.status }));
    const r = returnTrip(date, list);
    if (r && r.kind === 'return') out.push(Object.assign({}, r, { title: '' }));
  });
  return out;
}
function missingKmCount() {
  const rangeFrom = '0000-00-00', rangeTo = '9999-99-99';
  return tripsInRange(rangeFrom, rangeTo).filter(x => x.km == null).length;
}
let pendingRunning = false;
async function ensurePending(onDone) {
  if (pendingRunning || !S().apiKey || !navigator.onLine) return;
  pendingRunning = true; let changed = false;
  try {
    for (const a of DB.appts) {
      if (a.status === 'cancelled' || a.km != null) continue;
      const k = await routeKm(a.fromId, a.toId).catch(e => { throw e; });
      if (k != null) { a.km = k; a.kmManual = false; changed = true; }
    }
    const dates = [...new Set(DB.appts.filter(a => a.status !== 'cancelled').map(a => a.date))];
    for (const d of dates) {
      const r = returnTrip(d);
      if (r && r.kind === 'return' && r.km == null) { const k = await routeKm(r.fromId, r.toId); if (k != null) changed = true; }
    }
  } catch (e) { /* stop silently: key/net/quota issues are shown when the user acts */ }
  pendingRunning = false;
  if (changed) { saveDB(); }
  if (onDone) onDone(changed);
}

/* ---------- PIN ---------- */
const subtle = () => crypto.subtle;
async function pinHash(pin, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const base = await subtle().importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
async function setPin(pin) {
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  localStorage.setItem(LS_PIN, JSON.stringify({ salt, hash: await pinHash(pin, salt) }));
}
const hasPin = () => !!localStorage.getItem(LS_PIN);
async function checkPin(pin) {
  const p = JSON.parse(localStorage.getItem(LS_PIN) || 'null');
  return !!p && (await pinHash(pin, p.salt)) === p.hash;
}
function pinMeta() { try { return JSON.parse(localStorage.getItem(LS_META) || '{}'); } catch (e) { return {}; } }
const setPinMeta = m => localStorage.setItem(LS_META, JSON.stringify(m));
