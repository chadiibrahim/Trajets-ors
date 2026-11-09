'use strict';
/* Agenda Trajets - UI */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const UI = { tab: 'agenda', date: todayStr(), calOpen: false, calMonth: todayStr().slice(0, 8) + '01', filter: '', bkpwd: '', skipLock: false,
  rt: { period: 'month', anchor: todayStr(), from: todayStr().slice(0, 8) + '01', to: todayStr() }, keyTest: null };
let locked = true, hiddenAt = 0, toastTimer = null;

function toast(msg, isErr) {
  const el = $('#toast'); el.textContent = msg; el.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), isErr ? 5000 : 2200);
}

/* ---------- sheets ---------- */
const sheets = [];
function openSheet({ title, body, foot }) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sh-head"><h3>${esc(title)}</h3><button class="icon-btn" data-x aria-label="${esc(t('close'))}">✕</button></div><div class="sh-body">${body}</div>${foot ? '<div class="sh-foot"></div>' : ''}</div>`;
  $('#modals').appendChild(ov);
  const api = { el: ov, $: s => $(s, ov), $$: s => $$(s, ov), close() { const i = sheets.indexOf(api); if (i >= 0) sheets.splice(i, 1); ov.remove(); if (api.onClose) api.onClose(); } };
  $('[data-x]', ov).onclick = () => api.close();
  if (foot) {
    const f = $('.sh-foot', ov);
    foot.forEach(b => { const btn = document.createElement('button'); btn.className = 'btn ' + (b.cls || ''); btn.textContent = b.label; if (b.id) btn.id = b.id; btn.onclick = () => b.onClick(api, btn); f.appendChild(btn); });
  }
  sheets.push(api);
  return api;
}
function closeAllSheets() { while (sheets.length) sheets[sheets.length - 1].close(); }
function askText(title, label, type) {
  return new Promise(res => {
    let done = false;
    const sh = openSheet({ title, body: `<label class="f">${esc(label)}</label><input id="at-in" type="${type || 'text'}" autocomplete="off">`,
      foot: [{ label: t('cancel'), cls: 'ghost', onClick: s => s.close() }, { label: t('ok'), onClick: s => { done = true; const v = s.$('#at-in').value; s.close(); res(v); } }] });
    sh.onClose = () => { if (!done) res(null); };
    setTimeout(() => sh.$('#at-in').focus(), 50);
  });
}
const placeOptions = (sel) => {
  const list = DB.places.slice().sort((a, b) => (a.id === S().homeId ? -1 : b.id === S().homeId ? 1 : a.name.localeCompare(b.name, locale())));
  return `<option value="">${esc(t('choosePlace'))}</option>` + list.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc((p.id === S().homeId ? '🏠 ' : '') + p.name)}</option>`).join('');
};
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };

/* ---------- lock screen / PIN ---------- */
let lockState = { mode: 'unlock', entry: '', first: '' };
function showLock() {
  locked = true; closeAllSheets();
  $('#view').innerHTML = ''; ['#topbar', '#view', '#tabs'].forEach(s => $(s).classList.add('hidden'));
  $('#lock').classList.remove('hidden');
  lockState = { mode: hasPin() ? 'unlock' : 'create', entry: '', first: '' };
  drawLock();
}
function drawLock(msg) {
  const m = lockState.mode, L = $('#lock');
  const title = m === 'create' ? t('pinCreateTitle') : m === 'confirm' ? t('pinConfirmTitle') : t('pinUnlockTitle');
  const sub = m === 'create' ? t('pinCreateSub') : '';
  const n = Math.max(4, lockState.entry.length);
  const dots = Array.from({ length: n }, (_, i) => `<i class="${i < lockState.entry.length ? 'on' : ''}"></i>`).join('');
  const key = k => `<button data-k="${k}" ${k === 'ok' ? 'class="txt" aria-label="' + esc(t('pinValidate')) + '"' : ''}>${k === 'back' ? '⌫' : k === 'ok' ? 'OK' : k}</button>`;
  L.innerHTML = `<h2>${esc(title)}</h2><p>${esc(sub)}</p><div class="dots" id="dots">${dots}</div>
    <div class="keypad">${['1','2','3','4','5','6','7','8','9','back','0','ok'].map(key).join('')}</div>
    <div class="err" id="lockErr">${esc(msg || '')}</div>${m === 'unlock' ? `<button class="link" id="forgot">${esc(t('pinForgot'))}</button>` : ''}`;
  $$('.keypad button', L).forEach(b => b.onclick = () => pinKey(b.dataset.k));
  const f = $('#forgot'); if (f) f.onclick = () => { if (confirm(t('pinForgotText'))) eraseAll(); };
}
async function pinKey(k) {
  if (k === 'back') lockState.entry = lockState.entry.slice(0, -1);
  else if (k === 'ok') return submitPin();
  else if (lockState.entry.length < 8) lockState.entry += k;
  const d = $('#dots'); if (d) { const n = Math.max(4, lockState.entry.length); d.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < lockState.entry.length ? 'on' : ''}"></i>`).join(''); }
  const e = $('#lockErr'); if (e) e.textContent = '';
}
async function submitPin() {
  const L = lockState, pin = L.entry;
  if (L.mode === 'create') {
    if (pin.length < 4) return drawLockKeep(t('pinTooShort'));
    lockState = { mode: 'confirm', entry: '', first: pin }; return drawLock();
  }
  if (L.mode === 'confirm') {
    if (pin !== L.first) { lockState = { mode: 'create', entry: '', first: '' }; return drawLock(t('pinMismatch')); }
    await setPin(pin); return unlock();
  }
  const meta = pinMeta();
  if (meta.lockedUntil && meta.lockedUntil > Date.now()) return drawLockKeep(t('pinLocked', { s: Math.ceil((meta.lockedUntil - Date.now()) / 1000) }), true);
  if (pin.length < 1) return;
  if (await checkPin(pin)) { setPinMeta({}); return unlock(); }
  const tries = (meta.tries || 0) + 1, nm = { tries };
  if (tries % 5 === 0) nm.lockedUntil = Date.now() + 30000 * Math.pow(2, tries / 5 - 1);
  setPinMeta(nm);
  drawLockKeep(nm.lockedUntil ? t('pinLocked', { s: Math.ceil((nm.lockedUntil - Date.now()) / 1000) }) : t('pinWrong'), true);
}
function drawLockKeep(msg, clear) { if (clear) lockState.entry = ''; drawLock(msg); }
function unlock() {
  locked = false; $('#lock').classList.add('hidden'); $('#lock').innerHTML = '';
  ['#topbar', '#view', '#tabs'].forEach(s => $(s).classList.remove('hidden'));
  applyLang(); render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  ensurePending(c => { if (c && !locked) render(); });
}
document.addEventListener('keydown', e => {
  if (!$('#lock').classList.contains('hidden')) {
    if (/^[0-9]$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') pinKey('back'); else if (e.key === 'Enter') submitPin();
  } else if (e.key === 'Escape' && sheets.length) sheets[sheets.length - 1].close();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (UI.skipLock) { UI.skipLock = false; return; }
  if (!locked && hasPin()) { const m = S().lockMin; if (m === 0 || Date.now() - hiddenAt >= m * 60000) showLock(); }
});

/* ---------- language / chrome ---------- */
function applyLang() {
  document.documentElement.lang = S().lang;
  $$('[data-i]').forEach(e => e.textContent = t(e.dataset.i));
  document.title = t('appName');
  $('#btnLock').setAttribute('aria-label', t('lockNow'));
}
function setTab(tab) { UI.tab = tab; render(); $('#view').scrollTop = 0; }
$$('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#btnLock').onclick = () => showLock();

function render() {
  if (locked) return;
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === UI.tab));
  $('#topTitle').textContent = { agenda: t('tabAgenda'), places: t('placesTitle'), routes: t('routesTitle'), settings: t('settingsTitle') }[UI.tab];
  const v = $('#view'), st = v.scrollTop;
  v.innerHTML = { agenda: viewAgenda, places: viewPlaces, routes: viewRoutes, settings: viewSettings }[UI.tab]();
  v.scrollTop = st;
}

/* ---------- AGENDA ---------- */
const backupDue = () => {
  const f = S().backupFreq; if (f === 'never' || (!DB.appts.length && !DB.places.length)) return false;
  const days = { weekly: 7, biweekly: 14, monthly: 30 }[f]; if (!S().lastBackup) return true;
  return (Date.now() - new Date(S().lastBackup).getTime()) > days * 86400000;
};
function calHtml() {
  const first = UI.calMonth, d0 = parseYmd(first), lead = (d0.getDay() + 6) % 7, dim = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
  const have = new Set(DB.appts.filter(a => a.status !== 'cancelled' && a.date.startsWith(first.slice(0, 7))).map(a => a.date));
  let cells = t('dayShort').map(x => `<div class="dow">${x}</div>`).join('') + '<div></div>'.repeat(lead);
  for (let i = 1; i <= dim; i++) {
    const ds = first.slice(0, 8) + pad(i);
    cells += `<button class="d ${ds === UI.date ? 'sel' : ''} ${ds === todayStr() ? 'today' : ''} ${have.has(ds) ? 'has' : ''}" data-act="pickday" data-date="${ds}">${i}</button>`;
  }
  return `<div class="cal"><div class="head"><button class="btn ghost small" data-act="calprev">‹</button><span>${esc(t('monthNames')[d0.getMonth()])} ${d0.getFullYear()}</span><button class="btn ghost small" data-act="calnext">›</button></div><div class="grid">${cells}</div></div>`;
}
function apptCard(a) {
  const dur = toMin(a.end) - toMin(a.start), cancelled = a.status === 'cancelled';
  const fromP = place(a.fromId), toP = place(a.toId);
  const badge = a.status === 'done' ? `<span class="badge done">${esc(t('done'))}</span>` : cancelled ? `<span class="badge cancelled">${esc(t('cancelled'))}</span>` : `<span class="badge">${esc(t('planned'))}</span>`;
  return `<div class="card ${cancelled ? 'cancelled' : ''}" data-id="${a.id}">
    <div class="row"><div class="grow"><div class="time">${a.start} – ${a.end} <span class="muted">· ${esc(fmtDur(dur))}</span></div>${a.title ? `<div>${esc(a.title)}</div>` : ''}</div>${badge}</div>
    <div class="route">${esc(placeName(a.fromId, a.fromName))} → ${esc(placeName(a.toId, a.toName))}</div>
    <div class="row" style="margin-top:4px"><span class="km">${a.km == null ? `<span class="badge warn">${esc(t('distanceUnknown'))}</span>` : fmtKm(a.km) + ' km'}</span>${a.notes ? `<span class="muted grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">· ${esc(a.notes)}</span>` : ''}</div>
    <div class="actions">${a.status === 'planned' ? `<button class="btn small" data-act="finish" data-id="${a.id}">${esc(t('finish'))}</button>` : ''}
      <button class="btn small sec" data-act="edit" data-id="${a.id}">${esc(t('edit'))}</button>
      ${fromP && toP ? `<a class="btn small ghost" style="text-decoration:none" target="_blank" rel="noopener" href="${esc(mapsDirUrl(fromP, toP))}">${esc(t('route'))}</a>` : ''}
      <button class="btn small ghost" data-act="${cancelled ? 'restore' : 'cancel'}" data-id="${a.id}">${esc(cancelled ? t('restoreAppt') : t('cancelAppt'))}</button></div></div>`;
}
function returnCard(r) {
  if (!r) return '';
  if (r.needsHome) return `<div class="card ret"><div class="muted">🏠 ${esc(t('returnNoHome'))}</div><div class="actions"><button class="btn small sec" data-act="gosettings">${esc(t('tabSettings'))}</button></div></div>`;
  if (r.off) return `<div class="card ret"><div class="row"><div class="grow muted">🏠 ${esc(t('returnOff'))}</div><button class="btn small sec" data-act="returnrestore">${esc(t('returnRestore'))}</button></div></div>`;
  const dur = toMin(r.end) - toMin(r.start), fromP = place(r.fromId), toP = place(r.toId);
  const badge = r.status === 'done' ? `<span class="badge done">${esc(t('done'))}</span>` : `<span class="badge">${esc(t('planned'))}</span>`;
  return `<div class="card ret" data-date="${r.date}">
    <div class="row"><div class="grow"><div class="time">${r.start} – ${r.end} <span class="muted">· ${esc(fmtDur(dur))}</span></div><div>🏠 ${esc(t('returnHome'))}</div></div>${badge}</div>
    <div class="route">${esc(r.fromName)} → ${esc(r.toName)}</div>
    <div class="row" style="margin-top:4px"><span class="km">${r.km == null ? `<span class="badge warn">${esc(t('distanceUnknown'))}</span>` : fmtKm(r.km) + ' km'}</span></div>
    <div class="actions">${r.status === 'planned' ? `<button class="btn small" data-act="rfinish">${esc(t('finish'))}</button>` : ''}
      <button class="btn small sec" data-act="returnedit">${esc(t('edit'))}</button>
      ${fromP && toP ? `<a class="btn small ghost" style="text-decoration:none" target="_blank" rel="noopener" href="${esc(mapsDirUrl(fromP, toP))}">${esc(t('route'))}</a>` : ''}
      <button class="btn small ghost" data-act="returncancel">${esc(t('cancelReturn'))}</button></div></div>`;
}
function viewAgenda() {
  const date = UI.date, all = apptsOn(date, true), act = all.filter(a => a.status !== 'cancelled'), ret = returnTrip(date, act);
  const km = act.reduce((s, a) => s + (a.km || 0), 0) + (ret && ret.kind === 'return' && ret.km ? ret.km : 0);
  let h = '';
  if (backupDue()) h += `<div class="banner"><span>${esc(t('backupReminder'))}</span><button class="btn small" data-act="gobackup">${esc(t('backupNow'))}</button></div>`;
  const miss = missingKmCount();
  if (miss) h += `<div class="banner"><span>${esc(t('pendingKm', { n: miss }))}</span>${S().apiKey ? `<button class="btn small" data-act="retry">${esc(t('retryKm'))}</button>` : ''}</div>`;
  h += `<div class="datebar"><button class="nav" data-act="prevday" aria-label="-1">‹</button>
    <div class="label"><span id="dateLabel">${esc(fmtDate(date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }))}</span><input type="date" id="datePick" value="${date}" aria-label="${esc(t('date'))}"></div>
    <button class="nav" data-act="nextday" aria-label="+1">›</button></div>
    <div class="row wrap" style="margin-bottom:10px"><button class="btn small ${date === todayStr() ? 'ghost' : 'sec'}" data-act="today">${esc(t('today'))}</button><button class="btn small ghost" data-act="togglecal">📅 ${esc(t('monthView'))}</button>
    <span class="muted grow" style="text-align:right">${act.length ? esc(t(ret && ret.kind === 'return' ? 'dayTotalReturn' : 'dayTotal', { n: act.length, km: fmtKm(km) })) : ''}</span></div>`;
  if (UI.calOpen) h += calHtml();
  h += all.length ? all.map(apptCard).join('') + returnCard(ret) : `<div class="card muted" style="text-align:center">${esc(t('noAppt'))}</div>`;
  return h + `<button class="fab" data-act="newappt" aria-label="${esc(t('newAppt'))}">+</button>`;
}
function openApptForm(id, presetDate) {
  const a = id ? DB.appts.find(x => x.id === id) : null;
  const date = a ? a.date : (presetDate || UI.date);
  const others = apptsOn(date).filter(x => !a || x.id !== a.id);
  let last = null; others.forEach(x => { if (!last || x.end >= last.end) last = x; });
  const home = place(S().homeId);
  const nowHour = () => { const d = new Date(); return pad(Math.min(d.getHours() + 1, 23)) + ':00'; };
  const defFrom = a ? a.fromId : (last ? last.toId : (home ? home.id : ''));
  const defStart = a ? a.start : (last ? last.end : (date === todayStr() ? nowHour() : '09:00'));
  const defEnd = a ? a.end : fromMin(Math.min(toMin(defStart) + 60, 23 * 60 + 59));
  let kmManual = !!(a && a.kmManual), calcTok = 0;
  const sh = openSheet({ title: a ? t('editAppt') : t('newAppt'), body: `
    <label class="f">${esc(t('apptTitle'))} <span class="muted">(${esc(t('optional'))})</span></label><input id="f-title" type="text" placeholder="${esc(t('apptTitlePh'))}" value="${esc(a ? a.title : '')}">
    <label class="f">${esc(t('date'))}</label><input id="f-date" type="date" value="${date}">
    <div class="two"><div><label class="f">${esc(t('startTime'))}</label><input id="f-start" type="time" value="${defStart}"></div><div><label class="f">${esc(t('endTime'))}</label><input id="f-end" type="time" value="${defEnd}"></div></div>
    <label class="f">${esc(t('fromPlace'))}</label><div class="row"><select id="f-from" class="grow">${placeOptions(defFrom)}</select><button class="btn sec small" id="f-from-new" title="${esc(t('newPlace'))}">+</button></div>
    <label class="f">${esc(t('toPlace'))}</label><div class="row"><select id="f-to" class="grow">${placeOptions(a ? a.toId : '')}</select><button class="btn sec small" id="f-to-new" title="${esc(t('newPlace'))}">+</button></div>
    <label class="f">${esc(t('distance'))}</label><div class="row"><input id="f-km" type="text" inputmode="decimal" class="grow" value="${a && a.km != null ? a.km : ''}"><button class="btn sec small" id="f-recalc">${esc(t('recompute'))}</button></div>
    <div class="muted" id="f-kmstat" style="margin-top:3px"></div>
    <label class="f">${esc(t('notes'))} <span class="muted">(${esc(t('optional'))})</span></label><textarea id="f-notes">${esc(a ? a.notes || '' : '')}</textarea>`,
    foot: [...(a ? [{ label: t('delete'), cls: 'danger', onClick: s => { if (confirm(t('confirmDeleteAppt'))) { deleteAppt(a.id); s.close(); } } }] : []),
      { label: t('cancel'), cls: 'ghost', onClick: s => s.close() }, { label: t('save'), id: 'f-save', onClick: save }] });
  const autoKm = async (force) => {
    if (kmManual && !force) return;
    const f = sh.$('#f-from').value, to = sh.$('#f-to').value, st = sh.$('#f-kmstat'), inp = sh.$('#f-km');
    if (!f || !to) { if (!kmManual) inp.value = ''; st.textContent = ''; return; }
    const tok = ++calcTok;
    if (!force) { const c = cachedKm(f, to); if (c != null) { inp.value = c; st.textContent = t('distanceAuto'); return; } }
    const pf = place(f), pt = place(to);
    if (f !== to && !(hasCoords(pf) && hasCoords(pt))) { inp.value = ''; st.textContent = t('noCoords'); return; }
    if (!S().apiKey) { inp.value = ''; st.textContent = t('apiErrKey'); return; }
    st.textContent = t('computing');
    try { const km = await routeKm(f, to, force); if (tok !== calcTok) return; kmManual = false; inp.value = km; st.textContent = t('distanceAuto'); }
    catch (e) { if (tok !== calcTok) return; if (!kmManual) inp.value = ''; st.textContent = apiMessage(e); }
  };
  sh.$('#f-from').onchange = () => autoKm(); sh.$('#f-to').onchange = () => autoKm();
  sh.$('#f-recalc').onclick = () => { kmManual = false; autoKm(true); };
  sh.$('#f-km').oninput = e => { kmManual = e.target.value.trim() !== ''; if (kmManual) sh.$('#f-kmstat').textContent = t('distanceManual'); else autoKm(); };
  const newPlaceFor = which => () => openPlaceForm(null, p => { sh.$('#f-from').innerHTML = placeOptions(sh.$('#f-from').value); sh.$('#f-to').innerHTML = placeOptions(sh.$('#f-to').value); sh.$(which).value = p.id; autoKm(); });
  sh.$('#f-from-new').onclick = newPlaceFor('#f-from'); sh.$('#f-to-new').onclick = newPlaceFor('#f-to');
  if (a) sh.$('#f-kmstat').textContent = a.km == null ? t('distanceUnknown') : (a.kmManual ? t('distanceManual') : t('distanceAuto'));
  else autoKm();
  async function save(s, btn) {
    const v = { title: sh.$('#f-title').value.trim(), date: sh.$('#f-date').value, start: sh.$('#f-start').value, end: sh.$('#f-end').value,
      fromId: sh.$('#f-from').value, toId: sh.$('#f-to').value, notes: sh.$('#f-notes').value.trim() };
    if (!v.date || !v.start || !v.end) return toast(t('endBeforeStart'), true);
    if (v.end <= v.start) return toast(t('endBeforeStart'), true);
    if (!v.fromId || !v.toId) return toast(t('needPlaces'), true);
    const clash = apptsOn(v.date).find(x => (!a || x.id !== a.id) && x.start < v.end && v.start < x.end);
    if (clash && !confirm(t('overlapWarn', { t: clash.start + '–' + clash.end }))) return;
    btn.disabled = true;
    let km = null; const raw = sh.$('#f-km').value.trim();
    if (raw !== '') { km = num(raw); if (km != null) km = Math.max(0, round1(km)); }
    if (km == null) { try { km = await routeKm(v.fromId, v.toId); } catch (e) { km = null; } kmManual = false; }
    const rec = Object.assign(a || { id: uid(), status: 'planned', createdAt: Date.now() }, v, { km, kmManual: km != null && kmManual,
      fromName: placeName(v.fromId), toName: placeName(v.toId) });
    if (!a) DB.appts.push(rec);
    if (a && a.date !== v.date && !DB.appts.some(x => x.date === a.date && x.status !== 'cancelled')) delete DB.days[a.date];
    if (saveDB()) { s.close(); UI.date = v.date; UI.calMonth = v.date.slice(0, 8) + '01'; render(); ensurePending(c => { if (c && !locked) render(); }); }
    else btn.disabled = false;
  }
}
function deleteAppt(id) {
  const a = DB.appts.find(x => x.id === id); if (!a) return;
  DB.appts = DB.appts.filter(x => x.id !== id);
  if (!DB.appts.some(x => x.date === a.date && x.status !== 'cancelled')) delete DB.days[a.date];
  saveDB(); render(); toast(t('deleted'));
}
function finishDialog(o) {
  const now = new Date(), nowHm = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const initial = o.date === todayStr() && nowHm > o.start ? nowHm : o.end;
  const sh = openSheet({ title: t('finishTitle'), body: `<div class="muted">${esc(o.line)}</div>
    <div class="muted">${esc(t('plannedEnd', { t: o.plannedEnd }))}</div>
    <label class="f">${esc(t('realEnd'))}</label><input id="fin-end" type="time" value="${initial}">
    <div class="row wrap" style="margin-top:8px"><button class="btn sec small" data-q="now">${esc(t('finishNow'))}</button><button class="btn sec small" data-q="15">${esc(t('plus15'))}</button><button class="btn sec small" data-q="30">${esc(t('plus30'))}</button><button class="btn sec small" data-q="60">${esc(t('plus60'))}</button></div>`,
    foot: [{ label: t('cancel'), cls: 'ghost', onClick: s => s.close() }, { label: t('markDone'), id: 'fin-save', onClick: s => {
      const end = s.$('#fin-end').value;
      if (!end || end <= o.start) return toast(t('endBeforeStart'), true);
      if (o.onSave(end)) { s.close(); render(); }
    } }] });
  sh.$$('[data-q]').forEach(b => b.onclick = () => {
    const inp = sh.$('#fin-end');
    if (b.dataset.q === 'now') { const d = new Date(); inp.value = pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    else inp.value = fromMin(Math.min(toMin(inp.value || o.end) + Number(b.dataset.q), 23 * 60 + 59));
  });
}
function openFinish(id) {
  const a = DB.appts.find(x => x.id === id); if (!a) return;
  finishDialog({ date: a.date, start: a.start, end: a.end, plannedEnd: a.plannedEnd || a.end,
    line: `${a.start} – ${a.end} · ${placeName(a.fromId, a.fromName)} → ${placeName(a.toId, a.toName)}`,
    onSave: end => { if (!a.plannedEnd) a.plannedEnd = a.end; a.end = end; a.status = 'done'; return saveDB(); } });
}
function openFinishReturn(date) {
  const r = returnTrip(date); if (!r || r.kind !== 'return') return;
  finishDialog({ date, start: r.start, end: r.end, plannedEnd: r.plannedEnd || r.end, line: `${r.start} – ${r.end} · ${r.fromName} → ${r.toName}`,
    onSave: end => { const d = DB.days[date] = DB.days[date] || {}; if (!d.plannedEnd) d.plannedEnd = r.end; d.end = end; d.status = 'done'; return saveDB(); } });
}
function openReturnEdit(date) {
  const r = returnTrip(date); if (!r || r.needsHome) return;
  const day = DB.days[date] || {};
  let kmManual = !!day.kmManual, tok = 0, endTouched = !!day.end;
  const list = apptsOn(date), home = place(S().homeId);
  const lastAppt = list.reduce((m, x) => (x.end >= m.end ? x : m), list[0]);
  const lastTo = lastAppt.toId, lastEnd = lastAppt.end;
  const cur = r.off ? (day.fromId || lastTo) : r.fromId;
  const startV = r.off ? (day.start || lastEnd) : r.start;
  const endV = r.off ? (day.end && day.end > startV ? day.end : returnDefaultEnd(startV, cur, home.id)) : r.end;
  const sh = openSheet({ title: t('returnEdit'), body: `
    <div class="switch"><span>${esc(t('returnDisable'))}</span><input type="checkbox" id="r-off" ${r.off ? 'checked' : ''}></div>
    <div id="r-fields"><div class="two"><div><label class="f">${esc(t('startTime'))}</label><input id="r-start" type="time" value="${startV}"></div><div><label class="f">${esc(t('endTime'))}</label><input id="r-end" type="time" value="${endV}"></div></div>
    <label class="f">${esc(t('returnFrom'))}</label><select id="r-from">${placeOptions(cur)}</select>
    <div class="muted" style="margin-top:4px">→ 🏠 ${esc(home.name)}</div>
    <label class="f">${esc(t('distance'))}</label><div class="row"><input id="r-km" type="text" inputmode="decimal" class="grow" value="${r.km != null ? r.km : ''}"><button class="btn sec small" id="r-recalc">${esc(t('recompute'))}</button></div>
    <div class="muted" id="r-stat" style="margin-top:3px"></div></div>`,
    foot: [{ label: t('cancel'), cls: 'ghost', onClick: s => s.close() }, { label: t('save'), id: 'r-save', onClick: s => {
      const off = s.$('#r-off').checked;
      if (off) { DB.days[date] = Object.assign({}, day, { off: true }); if (saveDB()) { s.close(); render(); } return; }
      const fromId = s.$('#r-from').value, st = s.$('#r-start').value, en = s.$('#r-end').value;
      if (!st || !en || en <= st) return toast(t('endBeforeStart'), true);
      const d = { off: false };
      if (day.status) d.status = day.status;
      if (day.plannedEnd) d.plannedEnd = day.plannedEnd;
      if (fromId && fromId !== lastTo) d.fromId = fromId;
      const raw = s.$('#r-km').value.trim(), v = raw === '' ? null : num(raw);
      if (v != null && kmManual) { d.km = Math.max(0, round1(v)); d.kmManual = true; } else { d.km = null; d.kmManual = false; }
      if (st !== lastEnd) d.start = st;
      if (d.status === 'done' || en !== returnDefaultEnd(st, fromId || lastTo, home.id)) d.end = en;
      if (!d.fromId && d.km == null && !d.start && !d.end && !d.status) delete DB.days[date]; else DB.days[date] = d;
      if (saveDB()) { s.close(); render(); ensurePending(c => { if (c && !locked) render(); }); }
    } }] });
  const toggle = () => { sh.$('#r-fields').style.display = sh.$('#r-off').checked ? 'none' : ''; };
  const refreshEnd = () => { if (!endTouched && sh.$('#r-start').value) sh.$('#r-end').value = returnDefaultEnd(sh.$('#r-start').value, sh.$('#r-from').value || lastTo, home.id); };
  const auto = async force => {
    if (kmManual && !force) return;
    const f = sh.$('#r-from').value, st = sh.$('#r-stat'), inp = sh.$('#r-km'); const my = ++tok;
    if (!f) { inp.value = ''; return; }
    const c = force ? null : cachedKm(f, home.id); if (c != null) { inp.value = c; st.textContent = t('distanceAuto'); refreshEnd(); return; }
    if (f !== home.id && !(hasCoords(place(f)) && hasCoords(home))) { inp.value = ''; st.textContent = t('noCoords'); return; }
    st.textContent = t('computing');
    try { const km = await routeKm(f, home.id, force); if (my !== tok) return; kmManual = false; inp.value = km; st.textContent = t('distanceAuto'); refreshEnd(); }
    catch (e) { if (my !== tok) return; st.textContent = apiMessage(e); }
  };
  sh.$('#r-off').onchange = toggle; toggle();
  sh.$('#r-start').oninput = () => refreshEnd();
  sh.$('#r-end').oninput = () => { endTouched = true; };
  sh.$('#r-from').onchange = () => { kmManual = false; auto(); refreshEnd(); };
  sh.$('#r-recalc').onclick = () => { kmManual = false; auto(true); };
  sh.$('#r-km').oninput = e => { kmManual = e.target.value.trim() !== ''; sh.$('#r-stat').textContent = kmManual ? t('distanceManual') : ''; };
  sh.$('#r-stat').textContent = r.km == null ? t('distanceUnknown') : (r.manual ? t('distanceManual') : t('distanceAuto'));
}

/* ---------- PLACES ---------- */
function viewPlaces() {
  const f = UI.filter.trim().toLowerCase();
  const list = DB.places.slice().sort((a, b) => (a.id === S().homeId ? -1 : b.id === S().homeId ? 1 : a.name.localeCompare(b.name, locale())))
    .filter(p => !f || (p.name + ' ' + (p.address || '')).toLowerCase().includes(f));
  let h = `<input type="search" id="placeFilter" placeholder="${esc(t('filterPlaces'))}" value="${esc(UI.filter)}" style="margin-bottom:10px">`;
  if (!DB.places.length) h += `<div class="card muted" style="text-align:center">${esc(t('placesEmpty'))}</div>`;
  else if (!list.length) h += `<div class="card muted" style="text-align:center">${esc(t('noResults'))}</div>`;
  else h += `<div class="card" style="padding:4px 12px">${list.map(p => `<div class="list-row" data-act="editplace" data-id="${p.id}"><div class="grow"><b>${p.id === S().homeId ? '🏠 ' : ''}${esc(p.name)}</b>${p.address ? `<div class="muted">${esc(p.address)}</div>` : ''}</div>${hasCoords(p) ? '' : '<span class="badge warn">!</span>'}<span class="muted">›</span></div>`).join('')}</div>`;
  return h + `<button class="fab" data-act="newplace" aria-label="${esc(t('newPlaceTitle'))}">+</button>`;
}
function openPlaceForm(id, onSaved) {
  const p = id ? place(id) : null;
  const draft = p ? { gid: p.gid, name: p.name, address: p.address || '', lat: p.lat, lng: p.lng } : { gid: null, name: '', address: '', lat: null, lng: null };
  let autoName = '', timer = null, qTok = 0;
  const sh = openSheet({ title: p ? t('editPlaceTitle') : t('newPlaceTitle'), body: `
    <label class="f">${esc(t('searchPlace'))}</label><input id="pl-q" type="search" autocomplete="off" placeholder="${esc(t('searchPh'))}"><div id="pl-sugg"></div><div class="muted" id="pl-hint" style="margin-top:4px"></div>
    <div class="row" style="margin-top:8px"><button class="btn sec small" id="pl-map">🗺️ ${esc(t('pickOnMap'))}</button></div>
    <label class="f">${esc(t('placeName'))}</label><input id="pl-name" type="text" placeholder="${esc(t('placeNamePh'))}" value="${esc(draft.name)}">
    <label class="f">${esc(t('placeAddress'))} <span class="muted">(${esc(t('optional'))})</span></label><input id="pl-addr" type="text" value="${esc(draft.address)}">
    <label class="f">${esc(t('placeCoords'))}</label><div class="two"><input id="pl-lat" type="text" inputmode="decimal" placeholder="lat" value="${draft.lat != null ? draft.lat : ''}"><input id="pl-lng" type="text" inputmode="decimal" placeholder="lng" value="${draft.lng != null ? draft.lng : ''}"></div>
    <div class="switch"><span>🏠 ${esc(t('setHome'))}</span><input type="checkbox" id="pl-home" ${p && p.id === S().homeId ? 'checked' : ''}></div>
    ${p ? `<a class="btn small ghost" style="text-decoration:none;display:inline-block" target="_blank" rel="noopener" href="${esc(mapsPlaceUrl(p))}">${esc(t('openInMaps'))}</a>` : ''}`,
    foot: [...(p ? [{ label: t('delete'), cls: 'danger', onClick: s => {
      const n = DB.appts.filter(a => a.fromId === p.id || a.toId === p.id).length;
      if (!confirm(n ? t('placeUsed', { n }) : t('confirmDeletePlace'))) return;
      DB.places = DB.places.filter(x => x.id !== p.id); invalidateRoutes(p.id);
      if (S().homeId === p.id) S().homeId = null;
      saveDB(); s.close(); render(); toast(t('deleted'));
    } }] : []), { label: t('cancel'), cls: 'ghost', onClick: s => s.close() }, { label: t('save'), id: 'pl-save', onClick: save }] });
  const hint = (msg, err) => { const e = sh.$('#pl-hint'); e.textContent = msg || ''; e.style.color = err ? 'var(--danger)' : ''; };
  const syncFromDraft = () => {
    sh.$('#pl-addr').value = draft.address || ''; sh.$('#pl-lat').value = draft.lat != null ? draft.lat : ''; sh.$('#pl-lng').value = draft.lng != null ? draft.lng : '';
    const nm = sh.$('#pl-name'); if (draft.name && (!nm.value.trim() || nm.value === autoName)) { nm.value = draft.name; autoName = draft.name; }
  };
  const fillAddress = async () => { try { const a = await reverseGeocode(draft.lat, draft.lng); if (a) { draft.address = a; sh.$('#pl-addr').value = a; } } catch (e) { /* optional */ } };
  sh.$('#pl-q').oninput = e => {
    const q = e.target.value.trim(); clearTimeout(timer); sh.$('#pl-sugg').innerHTML = ''; hint('');
    if (q.length < 3) return;
    const c = parseCoords(q);
    if (c === 'short') return hint(t('linkNotResolved'), true);
    if (c) { draft.lat = c.lat; draft.lng = c.lng; hint(t('coordsRead', { c: c.lat + ', ' + c.lng })); syncFromDraft(); fillAddress(); return; }
    timer = setTimeout(async () => {
      const my = ++qTok; hint(t('searching'));
      try {
        const res = await placesAutocomplete(q); if (my !== qTok) return; hint('');
        sh.$('#pl-sugg').innerHTML = res.length ? `<div class="sugg">${res.map((r, i) => `<button data-i="${i}">${esc(r.main)}<small>${esc(r.secondary)}</small></button>`).join('')}</div>` : `<div class="muted">${esc(t('noResults'))}</div>`;
        $$('#pl-sugg button', sh.el).forEach(b => b.onclick = () => {
          const r = res[b.dataset.i];
          Object.assign(draft, { gid: r.gid, address: r.address, lat: r.lat, lng: r.lng, name: r.main });
          sh.$('#pl-sugg').innerHTML = ''; sh.$('#pl-q').value = ''; hint(''); syncFromDraft();
        });
      } catch (e) { if (my === qTok) hint(apiMessage(e), true); }
    }, 450);
  };
  sh.$('#pl-map').onclick = () => {
    const la = num(sh.$('#pl-lat').value), lo = num(sh.$('#pl-lng').value);
    openMapPicker(la != null && lo != null ? { lat: la, lng: lo } : null, async pt => {
      draft.lat = round6(pt.lat); draft.lng = round6(pt.lng); draft.gid = null; sh.$('#pl-lat').value = draft.lat; sh.$('#pl-lng').value = draft.lng;
      await fillAddress();
    });
  };
  function save(s, btn) {
    const name = sh.$('#pl-name').value.trim(); if (!name) return toast(t('placeNeedName'), true);
    const la = num(sh.$('#pl-lat').value), lo = num(sh.$('#pl-lng').value);
    const coords = la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
    const rec = p || { id: uid() };
    const changed = p && (rec.lat !== (coords ? la : null) || rec.lng !== (coords ? lo : null));
    Object.assign(rec, { name, address: sh.$('#pl-addr').value.trim(), lat: coords ? la : null, lng: coords ? lo : null, gid: draft.gid || null });
    if (!p) DB.places.push(rec);
    if (changed) invalidateRoutes(rec.id);
    DB.appts.forEach(a => { if (a.fromId === rec.id) a.fromName = rec.name; if (a.toId === rec.id) a.toName = rec.name; });
    if (sh.$('#pl-home').checked) S().homeId = rec.id; else if (S().homeId === rec.id) S().homeId = null;
    if (saveDB()) { s.close(); render(); if (onSaved) onSaved(rec); ensurePending(c => { if (c && !locked) render(); }); }
  }
}
const round6 = n => Math.round(n * 1e6) / 1e6;
function openMapPicker(start, onPick) {
  const homeP = place(S().homeId);
  let pt = start || (homeP && hasCoords(homeP) ? { lat: homeP.lat, lng: homeP.lng } : { lat: 33.8938, lng: 35.5018 });
  const sh = openSheet({ title: t('mapPickTitle'), body: `<div class="muted" style="margin-bottom:6px">${esc(t('mapPickHint'))}</div><div class="map" id="mp-map"></div><div class="muted" id="mp-coords"></div>`,
    foot: [{ label: t('cancel'), cls: 'ghost', onClick: s => s.close() }, { label: t('useThisPoint'), onClick: s => { s.close(); onPick(pt); } }] });
  let map = null; const prevClose = sh.close; sh.close = function () { if (map) { map.remove(); map = null; } prevClose.call(sh); };
  $('[data-x]', sh.el).onclick = () => sh.close();
  try {
    if (!window.L) { sh.$('.sh-body').innerHTML = `<div class="banner">${esc(t('mapLibMissing'))}</div>`; return; }
    map = L.map(sh.$('#mp-map'), { center: [pt.lat, pt.lng], zoom: start ? 16 : 12, zoomControl: true, attributionControl: true });
    window.__map = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
    const pin = L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [26, 36], iconAnchor: [13, 36] });
    const marker = L.marker([pt.lat, pt.lng], { icon: pin, keyboard: false }).addTo(map);
    const show = () => { sh.$('#mp-coords').textContent = round6(pt.lat) + ', ' + round6(pt.lng); };
    show();
    map.on('click', ev => { pt = { lat: ev.latlng.lat, lng: ev.latlng.lng }; marker.setLatLng(ev.latlng); show(); });
    setTimeout(() => map && map.invalidateSize(), 60);
  } catch (e) { sh.$('.sh-body').innerHTML = `<div class="banner">${esc(t('mapLoadFail'))}</div>`; }
}

/* ---------- ROUTES (mileage) ---------- */
function rtRange() {
  const r = UI.rt, a = r.anchor;
  if (r.period === 'day') return [a, a];
  if (r.period === 'week') { const m = mondayOf(a); return [m, addDays(m, 6)]; }
  if (r.period === 'month') { const f = a.slice(0, 8) + '01'; return [f, addDays(addMonths(f, 1), -1)]; }
  if (r.period === 'year') return [a.slice(0, 4) + '-01-01', a.slice(0, 4) + '-12-31'];
  return r.from <= r.to ? [r.from, r.to] : [r.to, r.from];
}
function rtLabel(from, to) {
  const p = UI.rt.period;
  if (p === 'day') return fmtDate(from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (p === 'week') return fmtDate(from, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(to, { day: 'numeric', month: 'short', year: 'numeric' });
  if (p === 'month') return t('monthNames')[parseYmd(from).getMonth()] + ' ' + from.slice(0, 4);
  if (p === 'year') return from.slice(0, 4);
  return fmtShort(from) + ' – ' + fmtShort(to);
}
const fmtShort = s => parseYmd(s).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
function buildReport() {
  const [from, to] = rtRange(), trips = tripsInRange(from, to), rate = num(S().rate) || 0, today = todayStr();
  const byDay = {}, byMonth = {};
  let km = 0, upcoming = 0, missing = 0;
  trips.forEach(x => {
    const k = x.km || 0; if (x.km == null) missing++;
    km += k; if (x.date > today) upcoming += k;
    const d = byDay[x.date] = byDay[x.date] || { n: 0, km: 0 }; d.n++; d.km += k;
    const m = byMonth[x.date.slice(0, 7)] = byMonth[x.date.slice(0, 7)] || { n: 0, km: 0 }; m.n++; m.km += k;
  });
  const dayCount = Object.keys(byDay).length;
  return { from, to, trips, km: round1(km), upcoming: round1(upcoming), missing, rate, cost: km * rate, days: dayCount, byDay, byMonth, label: rtLabel(from, to) };
}
function dayList(from, to) { const out = []; let d = from; while (d <= to) { out.push(d); d = addDays(d, 1); } return out; }
function monthList(from, to) { const out = []; let d = from.slice(0, 8) + '01'; while (d <= to) { out.push(d.slice(0, 7)); d = addMonths(d, 1); } return out; }
function barsHtml(items) {
  const max = Math.max(...items.map(i => i.km), 0.0001), step = Math.ceil(items.length / 10);
  return `<div class="bars">${items.map(i => `<div class="b ${i.km ? '' : 'zero'}" style="height:${Math.max(i.km / max * 100, 2)}%" data-act="barjump" data-key="${i.key}" title="${esc(i.title)}"></div>`).join('')}</div>
    <div class="bars-l">${items.map((i, ix) => `<span>${ix % step === 0 ? esc(i.label) : ''}</span>`).join('')}</div>`;
}
function viewRoutes() {
  const r = buildReport(), P = UI.rt.period, S_ = S();
  const seg = ['day', 'week', 'month', 'year', 'range'].map(p => `<button class="${P === p ? 'on' : ''}" data-act="period" data-p="${p}">${esc(t({ day: 'pDay', week: 'pWeek', month: 'pMonth', year: 'pYear', range: 'pRange' }[p]))}</button>`).join('');
  let h = `<div class="seg">${seg}</div>`;
  if (P === 'range') h += `<div class="two" style="margin-bottom:10px"><div><label class="f" style="margin-top:0">${esc(t('from'))}</label><input type="date" id="rt-from" value="${UI.rt.from}"></div><div><label class="f" style="margin-top:0">${esc(t('to'))}</label><input type="date" id="rt-to" value="${UI.rt.to}"></div></div>`;
  else h += `<div class="datebar"><button class="nav" data-act="rtprev">‹</button><div class="label">${esc(r.label)}</div><button class="nav" data-act="rtnext">›</button></div>`;
  h += `<div class="stats"><div class="stat"><b>${fmtKm(r.km)}</b><span>${esc(t('totalKm'))} (km)</span></div><div class="stat"><b>${r.trips.length}</b><span>${esc(t(r.trips.length === 1 ? 'trips1' : 'trips'))}</span></div><div class="stat"><b>${r.days}</b><span>${esc(t(r.days === 1 ? 'days1' : 'days'))}</span></div>`;
  h += (r.rate > 0 ? `<div class="stat"><b>${esc(fmtMoney(r.cost))}</b><span>${esc(t('cost'))}</span></div>` : '') + (r.days ? `<div class="stat"><b>${fmtKm(r.km / r.days)}</b><span>${esc(t('avgDay'))}</span></div>` : '') + '</div>';
  if (r.upcoming > 0) h += `<div class="muted" style="margin:-4px 0 8px">${esc(t('upcoming', { km: fmtKm(r.upcoming) }))}</div>`;
  if (r.missing) h += `<div class="banner"><span>${esc(t('missingKm', { n: r.missing }))}</span>${S_.apiKey ? `<button class="btn small" data-act="retry">${esc(t('retryKm'))}</button>` : ''}</div>`;
  if (!r.trips.length) return h + `<div class="card muted" style="text-align:center">${esc(t('noTrips'))}</div>`;
  const monthly = P === 'year' || (P === 'range' && dayList(r.from, r.to).length > 92);
  if (P === 'day') {
    h += `<div class="card" style="padding:4px 12px">${r.trips.map(x => `<div class="list-row" data-act="barjump" data-key="${x.date}"><div class="grow"><b>${x.kind === 'return' ? '🏠 ' + esc(t('tripReturn')) + ' · ' : ''}${esc(x.start + ' – ' + x.end)}</b><div class="muted">${esc(x.fromName)} → ${esc(x.toName)}</div></div><span class="km">${x.km == null ? '—' : fmtKm(x.km) + ' km'}</span></div>`).join('')}</div>`;
  } else if (monthly) {
    const ms = monthList(r.from, r.to);
    h += `<div class="card">${barsHtml(ms.map(m => ({ key: m, km: (r.byMonth[m] || { km: 0 }).km, label: t('monthNames')[+m.slice(5) - 1].slice(0, 3), title: m + ' : ' + fmtKm((r.byMonth[m] || { km: 0 }).km) + ' km' })))}</div>`;
    h += `<h2 class="sec">${esc(t('byMonth'))}</h2><div class="card" style="padding:4px 12px">${ms.filter(m => r.byMonth[m]).map(m => `<div class="list-row" data-act="barjump" data-key="${m}"><div class="grow"><b>${esc(t('monthNames')[+m.slice(5) - 1])} ${m.slice(0, 4)}</b></div><span class="muted">${r.byMonth[m].n} ${esc(t(r.byMonth[m].n === 1 ? 'trips1' : 'trips'))}</span><span class="km" style="min-width:70px;text-align:right">${fmtKm(r.byMonth[m].km)} km</span></div>`).join('')}</div>`;
  } else {
    const ds = dayList(r.from, r.to);
    h += `<div class="card">${barsHtml(ds.map(d => ({ key: d, km: (r.byDay[d] || { km: 0 }).km, label: String(+d.slice(8)), title: fmtShort(d) + ' : ' + fmtKm((r.byDay[d] || { km: 0 }).km) + ' km' })))}</div>`;
    h += `<h2 class="sec">${esc(t('byDay'))}</h2><div class="card" style="padding:4px 12px">${ds.filter(d => r.byDay[d]).map(d => `<div class="list-row" data-act="barjump" data-key="${d}"><div class="grow"><b>${esc(fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }))}</b></div><span class="muted">${r.byDay[d].n} ${esc(t(r.byDay[d].n === 1 ? 'trips1' : 'trips'))}</span><span class="km" style="min-width:70px;text-align:right">${fmtKm(r.byDay[d].km)} km</span></div>`).join('')}</div>`;
  }
  return h + `<div class="row" style="margin-top:6px"><button class="btn sec grow" data-act="xlsx">⬇ ${esc(t('exportXlsx'))}</button><button class="btn sec grow" data-act="pdf">⬇ ${esc(t('exportPdf'))}</button></div>`;
}
function reportRows(r) {
  const rate = r.rate;
  return r.trips.map(x => ({ date: x.date, start: x.start, end: x.end, type: x.kind === 'return' ? t('typeReturn') : t('typeAppt'),
    title: x.title || '', from: x.fromName, to: x.toName, km: x.km, cost: x.km != null && rate ? x.km * rate : null }));
}
function exportXlsx() {
  const r = buildReport(), rate = r.rate, b = v => ({ v, bold: true }), n = v => ({ v, num: true });
  const rows = reportRows(r);
  const head = [t('colDate'), t('colStart'), t('colEnd'), t('colType'), t('colTitle'), t('colFrom'), t('colTo'), t('colKm')].concat(rate ? [t('colCost')] : []).map(b);
  const detail = [head].concat(rows.map(x => [fmtShort(x.date), x.start, x.end, x.type, x.title, x.from, x.to, x.km == null ? '' : n(x.km)].concat(rate ? [x.cost == null ? '' : n(round2(x.cost))] : [])));
  const grp = (obj, keys, fmt) => [[b(fmt), b(t('colTrips')), b(t('colKm'))].concat(rate ? [b(t('colCost'))] : [])].concat(keys.filter(k => obj[k]).map(k => [fmt === t('colDay') ? fmtShort(k) : t('monthNames')[+k.slice(5) - 1] + ' ' + k.slice(0, 4), obj[k].n, n(round1(obj[k].km))].concat(rate ? [n(round2(obj[k].km * rate))] : [])));
  const summary = [[b(t('appName'))], [b(t('period')), r.label], [b(t('totalKm')), n(r.km)], [b(t('trips')), r.trips.length], [b(t('days')), r.days]].concat(rate ? [[b(t('ratePerKm')), n(rate)], [b(t('cost')), n(round2(r.cost))]] : []);
  const sheetsX = [{ name: t('summarySheet'), widths: [24, 28], rows: summary },
    { name: t('detailSheet'), widths: [12, 8, 8, 9, 22, 26, 26, 9, 11], rows: detail },
    { name: t('daySheet'), widths: [14, 9, 9, 11], rows: grp(r.byDay, dayList(r.from, r.to), t('colDay')) },
    { name: t('monthSheet'), widths: [20, 9, 9, 11], rows: grp(r.byMonth, monthList(r.from, r.to), t('colMonth')) }];
  deliverFile(Exporter.xlsx(sheetsX), `trajets_${r.from}_${r.to}.xlsx`);
}
const round2 = n => Math.round(n * 100) / 100;
function exportPdf() {
  const r = buildReport(), rate = r.rate, rows = reportRows(r);
  const monthly = monthList(r.from, r.to).length > 1;
  const sumCols = [{ label: monthly ? t('colMonth') : t('colDay'), w: 5 }, { label: t('colTrips'), w: 2, align: 'right' }, { label: t('colKm'), w: 2, align: 'right' }].concat(rate ? [{ label: t('colCost'), w: 3, align: 'right' }] : []);
  const keys = monthly ? monthList(r.from, r.to) : dayList(r.from, r.to), src = monthly ? r.byMonth : r.byDay;
  const sumRows = keys.filter(k => src[k]).map(k => [monthly ? t('monthNames')[+k.slice(5) - 1] + ' ' + k.slice(0, 4) : fmtShort(k), String(src[k].n), fmtKm(src[k].km)].concat(rate ? [fmtMoney(src[k].km * rate)] : []));
  sumRows.push([t('totalKm'), String(r.trips.length), fmtKm(r.km)].concat(rate ? [fmtMoney(r.cost)] : []));
  const dCols = [{ label: t('colDate'), w: 5 }, { label: t('colStart'), w: 3 }, { label: t('colEnd'), w: 3 }, { label: t('colType'), w: 3.5 }, { label: t('colFrom'), w: 9 }, { label: t('colTo'), w: 9 }, { label: t('colKm'), w: 3, align: 'right' }].concat(rate ? [{ label: t('colCost'), w: 4, align: 'right' }] : []);
  const dRows = rows.map(x => [fmtShort(x.date), x.start, x.end, x.type, x.from, x.to, x.km == null ? '—' : fmtKm(x.km)].concat(rate ? [x.cost == null ? '—' : fmtMoney(x.cost)] : []));
  const blob = Exporter.pdf({ title: t('appName') + ' – ' + t('routesTitle'), subtitle: `${t('period')} : ${r.label}  ·  ${fmtKm(r.km)} km  ·  ${r.trips.length} ${t('trips')}${rate ? '  ·  ' + fmtMoney(r.cost) : ''}`,
    blocks: [{ heading: monthly ? t('byMonth') : t('byDay'), columns: sumCols, rows: sumRows, bold: [sumRows.length - 1] }, { heading: t('detailSheet'), columns: dCols, rows: dRows }],
    footer: t('generated', { d: new Date().toLocaleString(locale()) }) });
  deliverFile(blob, `trajets_${r.from}_${r.to}.pdf`);
}
async function deliverFile(blob, name, forceDownload) {
  window.__lastFile = { blob, name };
  const file = new File([blob], name, { type: blob.type });
  if (!forceDownload && navigator.canShare && navigator.canShare({ files: [file] })) {
    UI.skipLock = true;
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/* ---------- SETTINGS ---------- */
function viewSettings() {
  const s = S(), home = place(s.homeId);
  const stat = UI.keyTest;
  const sel = (key, val, opts) => `<select data-set="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `
  <h2 class="sec">${esc(t('language'))}</h2><div class="card">${sel('lang', s.lang, [['fr', 'Français'], ['en', 'English']])}</div>
  <h2 class="sec">${esc(t('tabRoutes'))}</h2><div class="card">
    <label class="f" style="margin-top:0">${esc(t('home2'))}</label><select data-set="homeId"><option value="">${esc(t('homeNone'))}</option>${DB.places.map(p => `<option value="${p.id}" ${p.id === s.homeId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <div class="switch"><span>${esc(t('autoReturn'))}</span><input type="checkbox" data-set="autoReturn" ${s.autoReturn ? 'checked' : ''}></div>
    <div class="two"><div><label class="f">${esc(t('ratePerKm'))}</label><input type="text" inputmode="decimal" data-set="rate" value="${s.rate || ''}" placeholder="0"></div>
    <div><label class="f">${esc(t('currency'))}</label><input type="text" data-set="currency" value="${esc(s.currency)}" maxlength="6"></div></div></div>
  <h2 class="sec">OpenRouteService</h2><div class="card">
    <label class="f" style="margin-top:0">${esc(t('apiKey'))}</label>
    <div class="row"><input type="password" id="apikey" data-set="apiKey" value="${esc(s.apiKey)}" autocomplete="off" autocapitalize="off" spellcheck="false" class="grow"><button class="btn ghost small" data-act="togglekey">${esc(t('showKey'))}</button></div>
    <div class="muted" style="margin-top:4px">${esc(t('apiKeyHelp'))}</div>
    <div class="row" style="margin-top:8px"><button class="btn sec small" data-act="testkey" ${stat === 'running' ? 'disabled' : ''}>${esc(stat === 'running' ? t('testing') : t('testKey'))}</button></div>
    ${Array.isArray(stat) ? `<div style="margin-top:8px">${stat.map(x => `<div>${x.ok ? '✅' : '❌'} ${esc(x.name)}${x.ok ? '' : `<div class="muted" style="margin-left:24px">${esc(x.msg)}</div>`}</div>`).join('')}${stat.every(x => x.ok) ? `<div class="muted" style="margin-top:4px">${esc(t('testOk'))}</div>` : ''}</div>` : ''}
    <label class="f">${esc(t('regionCode'))}</label><input type="text" data-set="region" value="${esc(s.region)}" maxlength="2" style="max-width:90px" autocapitalize="off"><div class="muted" style="margin-top:3px">${esc(t('regionHelp'))}</div></div>
  <h2 class="sec">${esc(t('security'))}</h2><div class="card">
    <label class="f" style="margin-top:0">${esc(t('autoLock'))}</label>${sel('lockMin', s.lockMin, [[0, t('lock0')], [1, t('lock1')], [5, t('lock5')], [15, t('lock15')]])}
    <div class="row wrap" style="margin-top:10px"><button class="btn sec small" data-act="changepin">${esc(t('changePin'))}</button><button class="btn ghost small" data-act="locknow">${esc(t('lockNow'))}</button></div></div>
  <h2 class="sec">${esc(t('backup'))}</h2><div class="card" id="backupCard">
    <label class="f" style="margin-top:0">${esc(t('backupFreq'))}</label>${sel('backupFreq', s.backupFreq, [['never', t('never')], ['weekly', t('weekly')], ['biweekly', t('biweekly')], ['monthly', t('monthly')]])}
    <label class="f">${esc(t('backupPassword'))}</label><input type="password" id="bk-pwd" autocomplete="new-password" value="${esc(UI.bkpwd)}"><div class="muted" style="margin-top:3px">${esc(t('backupPasswordHelp'))}</div>
    <div class="muted" style="margin-top:6px">${esc(s.lastBackup ? t('lastBackup', { d: new Date(s.lastBackup).toLocaleString(locale()) }) : t('noBackupYet'))}</div>
    <div class="row wrap" style="margin-top:8px"><button class="btn small" data-act="bkshare">${esc(t('backupShare'))}</button><button class="btn sec small" data-act="bksave">${esc(t('backupSave'))}</button><button class="btn ghost small" data-act="bkrestore">${esc(t('backupRestore'))}</button></div>
    <input type="file" id="bk-file" accept=".json,application/json" class="hidden">
    <div class="muted" style="margin-top:6px">${esc(t('backupNoKey'))}</div></div>
  <h2 class="sec">${esc(t('storage'))}</h2><div class="card" id="storageCard"><span class="muted">…</span></div>
  <h2 class="sec">${esc(t('dangerZone'))}</h2><div class="card"><button class="btn danger small" data-act="eraseall">${esc(t('eraseAll'))}</button></div>
  <div class="muted" style="text-align:center;margin-top:12px">${esc(t('appName'))} · ${esc(t('version', { v: VERSION }))}<br>${esc(t('credits'))}</div>`;
}
async function fillStorage() {
  const el = $('#storageCard'); if (!el) return;
  if (!(navigator.storage && navigator.storage.persisted)) { el.innerHTML = `<span class="muted">${esc(t('storageUnknown'))}</span>`; return; }
  const on = await navigator.storage.persisted();
  let used = ''; try { const e = await navigator.storage.estimate(); used = t('storageUsed', { s: fmtSize(new Blob([localStorage.getItem(LS_DATA) || '']).size) }); } catch (e) { /* ignore */ }
  const card = $('#storageCard'); if (!card) return;
  card.innerHTML = `<b>${esc(on ? t('storageOn') : t('storageOff'))}</b>${on ? '' : ` <button class="btn sec small" data-act="persist">${esc(t('storageAsk'))}</button>`}<div class="muted">${esc(used)}</div>`;
}
async function testKey() {
  UI.keyTest = 'running'; render();
  const res = [], run = async (name, fn) => { try { await fn(); res.push({ name, ok: true }); } catch (e) { res.push({ name, ok: false, msg: e instanceof ApiError ? apiMessage(e) : t('error', { m: e.message }) }); } };
  await run(t('testPlaces'), async () => { const r = await placesAutocomplete('Beirut'); if (!r.length) throw new ApiError('other', t('noResults')); });
  await run(t('testRoutes'), () => computeRoute({ lat: 33.8938, lng: 35.5018 }, { lat: 33.8886, lng: 35.4955 }));
  await run(t('testGeocode'), () => reverseGeocode(33.8938, 35.5018));
  UI.keyTest = res; if (!locked && UI.tab === 'settings') render();
}
function openChangePin() {
  const sh = openSheet({ title: t('changePin'), body: `<label class="f">${esc(t('oldPin'))}</label><input id="cp-old" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
    <label class="f">${esc(t('newPin'))}</label><input id="cp-new" type="password" inputmode="numeric" maxlength="8" autocomplete="off">`,
    foot: [{ label: t('cancel'), cls: 'ghost', onClick: s => s.close() }, { label: t('save'), onClick: async s => {
      const o = s.$('#cp-old').value, n = s.$('#cp-new').value;
      if (!(await checkPin(o))) return toast(t('pinWrong'), true);
      if (!/^\d{4,8}$/.test(n)) return toast(t('pinTooShort'), true);
      await setPin(n); s.close(); toast(t('pinChanged'));
    } }] });
}
function backupObject() {
  const st = Object.assign({}, S()); delete st.apiKey;
  return { app: 'agenda-trajets', v: 1, exportedAt: new Date().toISOString(), data: { places: DB.places, appts: DB.appts, days: DB.days, routes: DB.routes, durs: DB.durs, settings: st } };
}
async function doBackup(share) {
  let obj = backupObject(); const pwd = UI.bkpwd;
  if (pwd) obj = await Exporter.encryptJson(obj, pwd);
  const ok = await deliverFile(new Blob([JSON.stringify(obj)], { type: 'application/json' }), `agenda-trajets_${todayStr()}.json`, !share);
  if (ok === false) return;
  S().lastBackup = new Date().toISOString(); saveDB(); toast(t('backupDone')); render();
}
async function restoreFrom(file) {
  let obj; try { obj = JSON.parse(await file.text()); } catch (e) { return toast(t('restoreBad'), true); }
  if (obj && obj.encrypted) {
    const pwd = await askText(t('backupRestore'), t('restorePwd'), 'password'); if (pwd == null) return;
    try { obj = await Exporter.decryptJson(obj, pwd); } catch (e) { return toast(t('restoreBad'), true); }
  }
  if (!obj || obj.app !== 'agenda-trajets' || !obj.data || !Array.isArray(obj.data.appts)) return toast(t('restoreBad'), true);
  if (!confirm(t('restoreAsk'))) return;
  const key = S().apiKey, d = obj.data, def = defaultDB();
  DB.places = d.places || []; DB.appts = d.appts || []; DB.days = d.days || {}; DB.routes = d.routes || {}; DB.durs = d.durs || {};
  DB.settings = Object.assign(def.settings, d.settings || {}, { apiKey: key });
  if (saveDB()) { toast(t('restoreOk')); applyLang(); render(); }
}
function eraseAll() { [LS_DATA, LS_PIN, LS_META].forEach(k => localStorage.removeItem(k)); location.reload(); }

/* ---------- events (delegated) ---------- */
const view = $('#view');
view.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  switch (act) {
    case 'prevday': UI.date = addDays(UI.date, -1); UI.calMonth = UI.date.slice(0, 8) + '01'; return render();
    case 'nextday': UI.date = addDays(UI.date, 1); UI.calMonth = UI.date.slice(0, 8) + '01'; return render();
    case 'today': UI.date = todayStr(); UI.calMonth = UI.date.slice(0, 8) + '01'; return render();
    case 'togglecal': UI.calOpen = !UI.calOpen; return render();
    case 'calprev': UI.calMonth = addMonths(UI.calMonth, -1); return render();
    case 'calnext': UI.calMonth = addMonths(UI.calMonth, 1); return render();
    case 'pickday': UI.date = el.dataset.date; return render();
    case 'newappt': return openApptForm(null);
    case 'edit': return openApptForm(id);
    case 'finish': return openFinish(id);
    case 'cancel': { const a = DB.appts.find(x => x.id === id); if (a) { a.status = 'cancelled'; saveDB(); render(); } return; }
    case 'restore': { const a = DB.appts.find(x => x.id === id); if (a) { a.status = a.plannedEnd ? 'done' : 'planned'; saveDB(); render(); ensurePending(c => { if (c && !locked) render(); }); } return; }
    case 'returnedit': return openReturnEdit(UI.date);
    case 'rfinish': return openFinishReturn(UI.date);
    case 'returncancel': { DB.days[UI.date] = Object.assign({}, DB.days[UI.date], { off: true }); saveDB(); render(); return; }
    case 'returnrestore': { const d = DB.days[UI.date]; if (d) { d.off = false; saveDB(); render(); ensurePending(c => { if (c && !locked) render(); }); } return; }
    case 'gosettings': return setTab('settings');
    case 'gobackup': setTab('settings'); setTimeout(() => { const c = $('#backupCard'); if (c) c.scrollIntoView(); }, 50); return;
    case 'retry': { el.disabled = true; await ensurePending(); const still = missingKmCount(); if (still) toast(t('pendingKm', { n: still }), true); render(); return; }
    case 'newplace': return openPlaceForm(null);
    case 'editplace': return openPlaceForm(id);
    case 'period': {
      const p = el.dataset.p, rt = UI.rt;
      if (p === 'range' && rt.period !== 'range') { const [f, to] = rtRange(); rt.from = f; rt.to = to; }
      rt.period = p; if (p !== 'range' && !rt.anchor) rt.anchor = todayStr(); return render();
    }
    case 'rtprev': case 'rtnext': {
      const dir = act === 'rtnext' ? 1 : -1, rt = UI.rt;
      rt.anchor = rt.period === 'day' ? addDays(rt.anchor, dir) : rt.period === 'week' ? addDays(rt.anchor, 7 * dir) : rt.period === 'month' ? addMonths(rt.anchor.slice(0, 8) + '01', dir) : (+rt.anchor.slice(0, 4) + dir) + '-01-01';
      return render();
    }
    case 'barjump': {
      const key = el.dataset.key;
      if (key.length === 7) { UI.rt.period = 'month'; UI.rt.anchor = key + '-01'; return render(); }
      UI.date = key; UI.calMonth = key.slice(0, 8) + '01'; return setTab('agenda');
    }
    case 'xlsx': return exportXlsx();
    case 'pdf': return exportPdf();
    case 'togglekey': { const i = $('#apikey'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = t(show ? 'hideKey' : 'showKey'); return; }
    case 'testkey': return testKey();
    case 'changepin': return openChangePin();
    case 'locknow': return showLock();
    case 'bkshare': return doBackup(true);
    case 'bksave': return doBackup(false);
    case 'bkrestore': UI.skipLock = true; return $('#bk-file').click();
    case 'persist': { try { await navigator.storage.persist(); } catch (err) { /* ignore */ } return fillStorage(); }
    case 'eraseall': if (confirm(t('eraseConfirm'))) eraseAll(); return;
  }
});
view.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'placeFilter') { UI.filter = el.value; const pos = el.selectionStart; render(); const n = $('#placeFilter'); n.focus(); n.setSelectionRange(pos, pos); }
  else if (el.id === 'bk-pwd') UI.bkpwd = el.value;
});
view.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'datePick') { if (el.value) { UI.date = el.value; UI.calMonth = el.value.slice(0, 8) + '01'; render(); } return; }
  if (el.id === 'rt-from' || el.id === 'rt-to') { if (el.value) { UI.rt[el.id === 'rt-from' ? 'from' : 'to'] = el.value; render(); } return; }
  if (el.id === 'bk-file') { const f = el.files[0]; el.value = ''; if (f) restoreFrom(f); return; }
  const key = el.dataset.set; if (!key) return;
  const s = S();
  if (key === 'lang') { s.lang = el.value; saveDB(); applyLang(); return render(); }
  if (key === 'homeId') { s.homeId = el.value || null; saveDB(); render(); ensurePending(c => { if (c && !locked) render(); }); return; }
  if (key === 'autoReturn') { s.autoReturn = el.checked; saveDB(); ensurePending(c => { if (c && !locked) render(); }); return; }
  if (key === 'rate') { s.rate = Math.max(0, num(el.value) || 0); saveDB(); return render(); }
  if (key === 'lockMin') { s.lockMin = Number(el.value); saveDB(); return; }
  if (key === 'apiKey') { s.apiKey = el.value.trim(); UI.keyTest = null; acCache.clear(); saveDB(); toast(t('saved')); ensurePending(c => { if (c && !locked) render(); }); return; }
  if (key === 'region') { s.region = el.value.trim().toLowerCase(); saveDB(); return; }
  if (key === 'currency') { s.currency = el.value.trim(); saveDB(); return; }
  if (key === 'backupFreq') { s.backupFreq = el.value; saveDB(); return; }
});
new MutationObserver(() => { if (UI.tab === 'settings' && !locked) fillStorage(); }).observe(view, { childList: true });
window.addEventListener('online', () => { if (!locked) ensurePending(c => { if (c) render(); }); });

/* ---------- init ---------- */
loadDB(); applyLang(); showLock();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
