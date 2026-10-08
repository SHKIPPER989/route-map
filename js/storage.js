/* =============================================================================
   storage.js
   Browser-local persistence via IndexedDB — two things live here:
     1. Autosave: every change (via App.sidebar.render(), debounced) is
        written to a reserved "__autosave__" record, so a reload or closed
        tab never loses work even without an explicit JSON export.
     2. Named "plans": explicit snapshots the user saves/loads/deletes by
        name ("План 1", "План 2", ...) via the "Збережені плани" section —
        useful for comparing or switching between scenarios in one browser,
        without juggling JSON files.
   This is per-browser storage — it does NOT replace 💾 Зберегти JSON for
   moving work to a different computer.
   ============================================================================= */
//const App = window.App || (window.App = {});

App.storage = {};

(function(){
  const { state, utils } = App;

  const DB_NAME = 'route-map-db';
  const STORE = 'plans';
  const AUTOSAVE_NAME = '__autosave__'; // hidden from the plans dropdown
  const AUTOSAVE_DEBOUNCE_MS = 600;

  const plansSelect   = document.getElementById('plansSelect');
  const planSaveBtn   = document.getElementById('planSaveBtn');
  const planLoadBtn   = document.getElementById('planLoadBtn');
  const planDeleteBtn = document.getElementById('planDeleteBtn');

  let dbPromise = null;
  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if(!window.indexedDB){ reject(new Error('IndexedDB not available')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function putRecord(record){
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function getRecord(name){
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }
  function deleteRecord(name){
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function getAllRecords(){
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  function snapshot(){
    return {
      savedAt: new Date().toISOString(),
      routes: state.routes.map(({ _expanded, ...r }) => r),
      markers: state.markers
    };
  }

  function applySnapshot(data){
    state.routes = utils.normalizeRoutes(data.routes);
    state.markers = utils.normalizeMarkers(data.markers);
    App.pointModal.stopMode();
    App.poi.cancelPlacing();
    App.map.renderAll();
    App.poi.renderAll();
    App.sidebar.render();
    const allPts = state.routes.flatMap(r => r.points);
    if(allPts.length) App.map.instance.fitBounds(L.latLngBounds(allPts.map(p => [p.lat, p.lng])).pad(0.2));
  }

  // ---- autosave --------------------------------------------------------------
  let autosaveTimer = null;
  function autosave(){
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      putRecord({ name: AUTOSAVE_NAME, ...snapshot() }).catch(() => {}); // best-effort — storage can be unavailable (e.g. private mode)
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // Called once at startup (main.js). Resolves true if an autosave with data
  // was found and applied, false otherwise — lets main.js decide whether to
  // still fall back to fetching routes.json.
  function loadAutosave(){
    return getRecord(AUTOSAVE_NAME).then(rec => {
      if(rec && ((rec.routes && rec.routes.length) || (rec.markers && rec.markers.length))){
        applySnapshot(rec);
        return true;
      }
      return false;
    }).catch(() => false);
  }

  // ---- named plans -------------------------------------------------------------
  function refreshPlansDropdown(){
    return getAllRecords().then(records => {
      const plans = records.filter(r => r.name !== AUTOSAVE_NAME).sort((a, b) => a.name.localeCompare(b.name));
      plansSelect.innerHTML = plans.length
        ? plans.map(p => `<option value="${utils.escapeHtml(p.name)}">${utils.escapeHtml(p.name)} (${new Date(p.savedAt).toLocaleString('uk-UA')})</option>`).join('')
        : '<option value="">— немає збережених планів —</option>';
    });
  }

  planSaveBtn.addEventListener('click', () => {
    getAllRecords().then(records => {
      const existingCount = records.filter(r => r.name !== AUTOSAVE_NAME).length;
      const suggested = `План ${existingCount + 1}`;
      const name = prompt('Назва плану:', suggested);
      if(!name) return;
      putRecord({ name: name.trim(), ...snapshot() }).then(refreshPlansDropdown);
    });
  });

  planLoadBtn.addEventListener('click', () => {
    const name = plansSelect.value;
    if(!name) return;
    if(!confirm(`Завантажити план «${name}»? Поточні незбережені зміни буде замінено.`)) return;
    getRecord(name).then(rec => { if(rec) applySnapshot(rec); });
  });

  planDeleteBtn.addEventListener('click', () => {
    const name = plansSelect.value;
    if(!name) return;
    if(!confirm(`Видалити план «${name}»?`)) return;
    deleteRecord(name).then(refreshPlansDropdown);
  });

  refreshPlansDropdown();

  App.storage = { autosave, loadAutosave, refreshPlansDropdown };
})();
