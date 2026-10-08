/* =============================================================================
   bulk-import.js
   Bulk-import fixation points from pasted CSV/TSV text — the kind of data
   you'd copy out of Excel or export from a GPS tracker/navigator. Groups
   rows into routes by name (creating new routes as needed) and adds the
   points. Deliberately simple: no quoted-field escaping, just split-by-
   delimiter — good enough for typical tracker exports, documented as a
   known limitation in the UI hint text.
   ============================================================================= */

App.bulkImport = {};

(function(){
  const { constants, state, utils } = App;

  const textarea = document.getElementById('bulkImportText');

  // Recognised header names (lower-cased) for each logical column. Add
  // synonyms here if a particular tracker export uses different wording.
  const HEADER_ALIASES = {
    route:  ['маршрут', 'route', 'назва маршруту', 'name'],
    type:   ['тип', 'type'],
    date:   ['дата', 'date'],
    time:   ['час', 'time'],
    lat:    ['широта', 'lat', 'latitude'],
    lng:    ['довгота', 'lng', 'lon', 'long', 'longitude'],
    source: ['джерело', 'source'],
    note:   ['примітка', 'прим', 'note', 'notes', 'comment']
  };

  // A small rotating palette so auto-created routes get distinct colours
  // without needing the user to pick one for every group.
  const AUTO_PALETTE = ['#4fa3ff', '#ff6b6b', '#51cf66', '#ffa94d', '#cc5de8', '#20c997', '#f06595'];
  let paletteIdx = 0;

  function detectDelimiter(firstLine){
    if(firstLine.includes('\t')) return '\t'; // pasted straight from Excel/Sheets
    if(firstLine.includes(';')) return ';';
    return ',';
  }

  function buildHeaderMap(headerCells){
    const map = {};
    headerCells.forEach((cell, i) => {
      const norm = cell.trim().toLowerCase();
      for(const [field, aliases] of Object.entries(HEADER_ALIASES)){
        if(aliases.includes(norm)) map[field] = i;
      }
    });
    return map;
  }

  function findOrCreateRoute(name, typeRaw){
    let r = state.routes.find(r => r.name.toLowerCase() === name.toLowerCase());
    if(r) return r;
    const type = /авто|vehicle|car/i.test(typeRaw || '') ? 'vehicle' : 'pedestrian';
    r = { id: utils.uid('r'), name, type, color: AUTO_PALETTE[paletteIdx++ % AUTO_PALETTE.length], tags: [], visible: true, points: [], bends: [], _expanded: true };
    state.routes.push(r);
    return r;
  }

  function resolveSourceType(raw){
    if(!raw) return 'other';
    const norm = raw.trim().toLowerCase();
    for(const [key, t] of Object.entries(constants.SOURCE_TYPES)){
      if(key === norm || t.label.toLowerCase() === norm) return key;
    }
    return 'other';
  }

  function runImport(){
    const raw = textarea.value.trim();
    if(!raw){ alert('Вставте дані для імпорту (скопійовані з Excel, або CSV-текст).'); return; }

    const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
    const delim = detectDelimiter(lines[0]);
    const headerMap = buildHeaderMap(lines[0].split(delim));

    if(headerMap.lat === undefined || headerMap.lng === undefined){
      alert('Не знайдено колонки з широтою/довготою. Перший рядок має бути заголовком, напр.:\nМаршрут,Тип,Дата,Час,Широта,Довгота,Джерело,Примітка');
      return;
    }

    const now = new Date();
    const defaultDate = now.toISOString().slice(0, 10);
    const defaultTime = now.toTimeString().slice(0, 5);
    const defaultRouteName = 'Імпортований маршрут ' + now.toLocaleDateString('uk-UA');

    let imported = 0, skipped = 0;
    const touchedRoutes = new Set();

    for(let i = 1; i < lines.length; i++){
      const cells = lines[i].split(delim);
      const lat = parseFloat((cells[headerMap.lat] || '').replace(',', '.'));
      const lng = parseFloat((cells[headerMap.lng] || '').replace(',', '.'));
      if(!isFinite(lat) || !isFinite(lng)){ skipped++; continue; }

      const routeName = headerMap.route !== undefined ? (cells[headerMap.route] || '').trim() || defaultRouteName : defaultRouteName;
      const typeRaw = headerMap.type !== undefined ? cells[headerMap.type] : '';
      const route = findOrCreateRoute(routeName, typeRaw);
      touchedRoutes.add(route.id);

      route.points.push({
        id: utils.uid('p'), lat, lng,
        date: (headerMap.date !== undefined && cells[headerMap.date]) ? cells[headerMap.date].trim() : defaultDate,
        time: (headerMap.time !== undefined && cells[headerMap.time]) ? cells[headerMap.time].trim() : defaultTime,
        sourceType: resolveSourceType(headerMap.source !== undefined ? cells[headerMap.source] : ''),
        note: headerMap.note !== undefined ? (cells[headerMap.note] || '').trim() : '',
        photo: null
      });
      imported++;
    }

    touchedRoutes.forEach(id => App.map.renderRoute(state.routes.find(r => r.id === id)));
    App.sidebar.render();
    textarea.value = '';
    alert(`Імпортовано точок: ${imported}${skipped ? `, пропущено (без координат): ${skipped}` : ''}.`);
  }

  document.getElementById('bulkImportBtn').addEventListener('click', runImport);
})();
