/* =============================================================================
   export.js
   Everything that leaves the app: JSON save/load (for moving work between
   computers), a CSV route log (opens directly in Excel), and a print/PDF
   view with an auto-generated legend of the currently visible routes —
   a document ready to attach to a case file.
   ============================================================================= */
//const App = window.App || (window.App = {});

App.exportImport = {};

(function(){
  const { constants, state, utils } = App;

  function downloadBlob(content, mime, filename){
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- JSON (full data, round-trips everything incl. photos/bends) -------------
  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = { exportedAt: new Date().toISOString(), routes: state.routes.map(({ _expanded, ...r }) => r) };
    downloadBlob(JSON.stringify(data, null, 2), 'application/json', 'routes.json');
  });

  const fileInput = document.getElementById('fileInput');
  document.getElementById('importBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const data = JSON.parse(reader.result);
        if(!data || !Array.isArray(data.routes)) throw new Error('bad format');
        state.routes = utils.normalizeRoutes(data.routes);
        App.pointModal.stopMode();
        App.map.renderAll();
        App.sidebar.render();
        const allPts = state.routes.flatMap(r => r.points);
        if(allPts.length) App.map.instance.fitBounds(L.latLngBounds(allPts.map(p => [p.lat, p.lng])).pad(0.2));
      }catch(err){
        alert('Не вдалося прочитати файл: ' + err.message);
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  // ---- CSV route log (opens in Excel; Word can import CSV as a table too) ------
  function csvEscape(v){
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  document.getElementById('csvExportBtn').addEventListener('click', () => {
    const rows = [['Маршрут', 'Тип', 'Теги', 'Дата', 'Час', 'Широта', 'Довгота', 'Джерело', 'Примітка']];
    state.routes.forEach(r => {
      utils.sortedPoints(r).forEach(p => {
        rows.push([
          r.name, r.type === 'vehicle' ? 'Авто' : 'Пішохід', (r.tags || []).join('; '),
          p.date, p.time, p.lat, p.lng,
          (constants.SOURCE_TYPES[p.sourceType] || constants.SOURCE_TYPES.other).label, p.note || ''
        ]);
      });
    });
    // Leading BOM so Excel detects UTF-8 and renders Cyrillic text correctly.
    const csv = '\uFEFF' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
    downloadBlob(csv, 'text/csv;charset=utf-8', 'route-log.csv');
  });

  // ---- print / PDF with an auto-built legend -------------------------------------
  document.getElementById('printBtn').addEventListener('click', () => {
    const legend = document.getElementById('printLegend');
    const visible = state.routes.filter(r => r.visible);
    legend.innerHTML = '<h2>Карта маршрутів — легенда</h2>' +
      '<p>' + new Date().toLocaleString('uk-UA') + '</p>' +
      '<table><tr><th>Маршрут</th><th>Тип</th><th>Теги</th><th>Точок</th></tr>' +
      visible.map(r => `<tr>
          <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${r.color};margin-right:6px;"></span>${utils.escapeHtml(r.name)}</td>
          <td>${r.type === 'vehicle' ? 'Авто' : 'Пішохід'}</td>
          <td>${utils.escapeHtml((r.tags || []).join(', '))}</td>
          <td>${r.points.length}</td>
        </tr>`).join('') + '</table>';
    // Small delay so the legend is in the DOM before the browser's print
    // dialog (which also offers "Save as PDF" as a destination) opens.
    setTimeout(() => window.print(), 150);
  });

  App.exportImport = { downloadBlob };
})();
