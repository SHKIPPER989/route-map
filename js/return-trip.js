/* =============================================================================
   return-trip.js
   "↩ Дорога назад…" (route-line right-click menu): makes a NEW route that runs back
   along the chosen one — the same points in the opposite order, with their labels
   (notes), sources and the route's tags and type, plus the line's shape (bends) — in
   another colour. What the copy cannot know is WHEN the return trip happened, so a
   dialog lists every point (with its label) and asks for a date and time for each; a
   helper fills them all in from a start time using the same intervals as the original.
   Photos are not copied: they belong to the original sighting.
   The new route is drawn dashed by default (route.dashed): it follows the same path as
   the original and would otherwise hide it.
   ============================================================================= */
//const App = window.App || (window.App = {});

App.returnTrip = {};

(function(){
  const { constants, state, utils } = App;
  const $ = id => document.getElementById(id);

  const overlay    = $('returnModalOverlay');
  const titleEl    = $('returnModalTitle');
  const nameInput  = $('returnName');
  const colorInput = $('returnColor');
  const dashedChk  = $('returnDashed');
  const startDate  = $('returnStartDate');
  const startTime  = $('returnStartTime');
  const listEl     = $('returnList');
  const errorEl    = $('returnError');

  let source = null;   // the route we are making a return trip for
  let pts = [];        // its points in their current (time) order
  let rows = [];       // one per point of the NEW route: {date, time} inputs, new order = pts reversed

  // Colours offered for the new route: the first one no route uses yet (so it stands out).
  const PALETTE = ['#2a9d8f', '#f4a261', '#6a4c93', '#1982c4', '#8ac926', '#ff595e', '#e9c46a', '#264653'];
  function pickColor(avoid){
    const used = new Set(state.routes.map(r => String(r.color).toLowerCase()));
    const free = PALETTE.find(c => !used.has(c));
    if(free) return free;
    const m = /^#?([0-9a-f]{6})$/i.exec(avoid || '');          // everything is taken: use the opposite colour
    return m ? '#' + (0xFFFFFF ^ parseInt(m[1], 16)).toString(16).padStart(6, '0') : '#2a9d8f';
  }

  const stamp = p => Date.parse(`${p.date}T${p.time}`);
  const pad2 = v => String(v).padStart(2, '0');
  function fromMs(ms){
    const d = new Date(Math.round(ms / 60000) * 60000);        // whole minutes
    return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
  }
  const shortDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ''); };

  // ---- the dialog ---------------------------------------------------------------------
  function showError(msg){ errorEl.textContent = msg; errorEl.style.display = msg ? 'block' : 'none'; }

  function open(routeId){
    source = state.routes.find(r => r.id === routeId);
    if(!source || source.points.length < 2) return;
    pts = utils.sortedPoints(source);
    const n = pts.length;

    titleEl.textContent = `Дорога назад — «${source.name}»`;
    nameInput.value = `${source.name} (назад)`;
    colorInput.value = pickColor(source.color);
    dashedChk.checked = true;
    startDate.value = pts[n - 1].date;                          // suggestion: the return trip starts when the original ended
    startTime.value = pts[n - 1].time;
    showError('');

    // One row per point of the new route (= the source's points, last one first).
    listEl.innerHTML = '<div class="return-row return-head"><span>№</span><span>Точка</span><span>Дата</span><span>Час</span></div>';
    rows = [];
    for(let j = 0; j < n; j++){
      const o = pts[n - 1 - j];
      const icon = (constants.SOURCE_TYPES[o.sourceType] || constants.SOURCE_TYPES.other).icon;
      const label = o.note ? o.note : `Точка №${n - j}`;
      const row = document.createElement('div');
      row.className = 'return-row';
      row.innerHTML =
        `<span class="return-n">${j + 1}</span>` +
        `<span class="return-label"><span>${icon} ${utils.escapeHtml(label)}</span>` +
        `<small>було ${utils.escapeHtml(shortDate(o.date))} ${utils.escapeHtml(o.time)} · ${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}</small></span>` +
        `<input type="date"><input type="time">`;
      const [d, t] = row.querySelectorAll('input');
      [d, t].forEach(inp => inp.addEventListener('input', () => { inp.classList.remove('invalid'); showError(''); }));
      rows.push({ date: d, time: t });
      listEl.appendChild(row);
    }
    overlay.style.display = 'flex';
    rows[0].date.focus();
  }

  function close(){
    overlay.style.display = 'none';
    source = null; pts = []; rows = [];
  }

  // Fills every row from the start date/time, keeping the original travel times between points:
  // the first point of the way back gets the start time, each next one the same gap as on the way there.
  function fillFromStart(){
    const base = Date.parse(`${startDate.value}T${startTime.value}`);
    if(!isFinite(base)){ showError('Вкажіть дату й час початку руху назад.'); return; }
    const n = pts.length, end = stamp(pts[n - 1]);
    if(!isFinite(end)){ showError('У вихідного маршруту немає коректних дати й часу — заповніть рядки вручну.'); return; }
    rows.forEach((row, j) => {
      const t = stamp(pts[n - 1 - j]);
      if(!isFinite(t)) return;
      const v = fromMs(base + (end - t));
      row.date.value = v.date; row.time.value = v.time;
      row.date.classList.remove('invalid'); row.time.classList.remove('invalid');
    });
    showError('');
  }

  // ---- creating the route ------------------------------------------------------------------
  function validate(){
    rows.forEach(r => { r.date.classList.remove('invalid'); r.time.classList.remove('invalid'); });
    if(!nameInput.value.trim()){ showError('Вкажіть назву нового маршруту.'); return false; }
    let missing = false;
    rows.forEach(r => {
      if(!r.date.value){ r.date.classList.add('invalid'); missing = true; }
      if(!r.time.value){ r.time.classList.add('invalid'); missing = true; }
    });
    if(missing){ showError('Вкажіть дату й час для кожної точки (або натисніть «Заповнити час за тими ж інтервалами»).'); return false; }
    const st = rows.map(r => Date.parse(`${r.date.value}T${r.time.value}`));
    for(let i = 1; i < st.length; i++){
      if(st[i] < st[i - 1]){          // times decide the direction, so they must not go backwards
        [i - 1, i].forEach(k => { rows[k].date.classList.add('invalid'); rows[k].time.classList.add('invalid'); });
        showError(`Час не має зменшуватись від першої точки до останньої: точка ${i + 1} раніше за точку ${i}. Інакше напрямок маршруту зміниться.`);
        return false;
      }
    }
    return true;
  }

  function create(){
    if(!validate()) return;
    const n = pts.length;
    // New points: the source's points, last one first. No photos (they belong to the original sighting).
    const points = rows.map((row, j) => {
      const o = pts[n - 1 - j];
      return { id: utils.uid('p'), lat: o.lat, lng: o.lng, date: row.date.value, time: row.time.value,
               sourceType: o.sourceType || 'other', note: o.note || '', photo: null };
    });
    const newIdOf = new Map(pts.map((o, k) => [o.id, points[n - 1 - k].id]));      // old point id -> its copy
    const bends = utils.reverseBends(pts, source.bends).map(b => ({
      id: utils.uid('b'), lat: b.lat, lng: b.lng, afterPointId: newIdOf.get(b.afterPointId)
    }));
    const route = {
      id: utils.uid('r'), name: nameInput.value.trim(), type: source.type, color: colorInput.value,
      tags: (source.tags || []).slice(), visible: true, dashed: dashedChk.checked,
      points, bends, _expanded: true
    };
    state.routes.splice(state.routes.indexOf(source) + 1, 0, route);               // right after the original
    close();
    App.map.renderRoute(route);
    App.sidebar.render();
  }

  $('returnFillBtn').addEventListener('click', fillFromStart);
  $('returnCreate').addEventListener('click', create);
  $('returnCancel').addEventListener('click', close);
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && overlay.style.display === 'flex') close(); });

  App.returnTrip = { open };
})();
