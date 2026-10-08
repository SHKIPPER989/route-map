/* =============================================================================
   point-modal.js
   The "Нова точка фіксації" / "Редагувати точку" modal: starting and
   stopping the map-click "add point" / "add bend" modes, opening the modal
   for a new point or to edit an existing one, clipboard-paste helpers for
   coordinates and photos, and saving (create or update).
   ============================================================================= */

App.pointModal = {};

(function(){
  const { state, utils } = App;

  const addModeBar   = document.getElementById('addModeBar');
  const addModeText  = document.getElementById('addModeText');

  const overlay          = document.getElementById('pointModalOverlay');
  const modalTitle        = document.getElementById('pointModalTitle');
  const ptDate            = document.getElementById('ptDate');
  const ptTime            = document.getElementById('ptTime');
  const ptLat             = document.getElementById('ptLat');
  const ptLng             = document.getElementById('ptLng');
  const ptPasteCoords     = document.getElementById('ptPasteCoords');
  const ptPasteCoordsBtn  = document.getElementById('ptPasteCoordsBtn');
  const ptSourceType      = document.getElementById('ptSourceType');
  const ptNote            = document.getElementById('ptNote');
  const ptPhotoUrl        = document.getElementById('ptPhotoUrl');
  const ptPhotoZone       = document.getElementById('ptPhotoZone');
  const ptPhotoFile       = document.getElementById('ptPhotoFile');
  const ptPhotoPreview    = document.getElementById('ptPhotoPreview');
  const ptPhotoClearBtn   = document.getElementById('ptPhotoClearBtn');

  let pendingPhotoData = null; // base64 data: URI captured via paste/file, or null

  // ---- add / bend map-click modes ---------------------------------------------
  function startAddMode(routeId){
    App.poi.cancelPlacing(); // placing a point and a POI marker at once would be confusing
    state.activeRouteId = routeId;
    state.mode = 'point';
    const r = state.routes.find(r => r.id === routeId);
    addModeText.textContent = `Клікніть на карті, щоб додати точку до «${r.name}» (або ⌨ у списку — ввести координати)`;
    addModeBar.style.display = 'flex';
    App.map.instance.getContainer().style.cursor = 'crosshair';
    App.sidebar.render();
  }

  function startBendMode(routeId){
    App.poi.cancelPlacing();
    state.activeRouteId = routeId;
    state.mode = 'bend';
    const r = state.routes.find(r => r.id === routeId);
    addModeText.textContent = `Клікніть на карті біля потрібного відрізка «${r.name}», щоб додати коліно`;
    addModeBar.style.display = 'flex';
    App.map.instance.getContainer().style.cursor = 'crosshair';
    App.sidebar.render();
  }

  function stopMode(){
    state.mode = null;
    state.activeRouteId = null;
    addModeBar.style.display = 'none';
    App.map.instance.getContainer().style.cursor = '';
    App.sidebar.render();
  }
  document.getElementById('stopAddBtn').addEventListener('click', () => { stopMode(); App.poi.cancelPlacing(); });

  // ---- coordinate paste (shared parser lives in state.js: App.utils.parseCoordsFromText) ---
  ptPasteCoords.addEventListener('input', () => {
    const coords = utils.parseCoordsFromText(ptPasteCoords.value);
    if(coords){ ptLat.value = coords.lat.toFixed(6); ptLng.value = coords.lng.toFixed(6); }
    ptPasteCoords.value = '';
  });
  // Optional convenience button using the async Clipboard API — needs an
  // https (or localhost) context and user permission, so it can still fail
  // on GitHub Pages if the browser blocks it; falls back to asking for Ctrl+V.
  ptPasteCoordsBtn.addEventListener('click', async () => {
    try{
      const text = await navigator.clipboard.readText();
      const coords = utils.parseCoordsFromText(text);
      if(coords){ ptLat.value = coords.lat.toFixed(6); ptLng.value = coords.lng.toFixed(6); }
      else alert('У буфері не знайдено координат.');
    }catch(err){
      alert('Немає доступу до буфера обміну в цьому режимі. Вставте координати (Ctrl+V) у поле вище.');
    }
  });

  // ---- photo attach (paste or file) ----------------------------------------------
  function setPhotoPreview(dataUrlOrUrl){
    pendingPhotoData = dataUrlOrUrl;
    if(dataUrlOrUrl){
      ptPhotoPreview.src = dataUrlOrUrl;
      ptPhotoPreview.style.display = 'block';
      ptPhotoClearBtn.style.display = 'block';
    } else {
      ptPhotoPreview.style.display = 'none';
      ptPhotoClearBtn.style.display = 'none';
    }
  }
  ptPhotoZone.addEventListener('paste', e => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for(const item of items){
      if(item.type && item.type.startsWith('image/')){
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () => setPhotoPreview(reader.result);
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  });
  ptPhotoZone.addEventListener('click', () => ptPhotoFile.click());
  ptPhotoFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  });
  ptPhotoClearBtn.addEventListener('click', () => setPhotoPreview(null));

  // ---- open / close -----------------------------------------------------------
  function openForAdd(latlng){
    state.editingPointId = null;
    modalTitle.textContent = 'Нова точка фіксації';
    const now = new Date();
    ptDate.value = now.toISOString().slice(0, 10);
    ptTime.value = now.toTimeString().slice(0, 5);
    ptSourceType.value = 'other';
    ptNote.value = '';
    ptPhotoUrl.value = '';
    setPhotoPreview(null);
    ptLat.value = latlng ? latlng.lat.toFixed(6) : '';
    ptLng.value = latlng ? latlng.lng.toFixed(6) : '';
    overlay.style.display = 'flex';
  }

  function openForEdit(routeId, pointId){
    const r = state.routes.find(r => r.id === routeId);
    const p = r && r.points.find(p => p.id === pointId);
    if(!p) return;
    state.editingPointId = { routeId, pointId };
    modalTitle.textContent = 'Редагувати точку';
    ptDate.value = p.date;
    ptTime.value = p.time;
    ptLat.value = p.lat;
    ptLng.value = p.lng;
    ptSourceType.value = p.sourceType || 'other';
    ptNote.value = p.note || '';
    const isDataPhoto = p.photo && p.photo.startsWith('data:');
    ptPhotoUrl.value = isDataPhoto ? '' : (p.photo || '');
    setPhotoPreview(isDataPhoto ? p.photo : null);
    overlay.style.display = 'flex';
  }

  function close(){
    state.editingPointId = null;
    overlay.style.display = 'none';
  }
  document.getElementById('ptCancel').addEventListener('click', close);

  document.getElementById('ptSave').addEventListener('click', () => {
    const routeId = state.editingPointId ? state.editingPointId.routeId : state.activeRouteId;
    if(!routeId) return close();

    const latVal = parseFloat(ptLat.value);
    const lngVal = parseFloat(ptLng.value);
    if(!isFinite(latVal) || !isFinite(lngVal)){
      alert('Вкажіть коректні координати (широта та довгота)');
      return;
    }

    const photo = pendingPhotoData || ptPhotoUrl.value.trim() || null;
    const r = state.routes.find(r => r.id === routeId);

    if(state.editingPointId){
      const p = r.points.find(p => p.id === state.editingPointId.pointId);
      Object.assign(p, {
        lat: latVal, lng: lngVal, date: ptDate.value, time: ptTime.value || '00:00',
        sourceType: ptSourceType.value, note: ptNote.value.trim(), photo
      });
    } else {
      r.points.push({
        id: utils.uid('p'), lat: latVal, lng: lngVal,
        date: ptDate.value, time: ptTime.value || '00:00',
        sourceType: ptSourceType.value, note: ptNote.value.trim(), photo
      });
    }

    close();
    App.map.renderRoute(r);
    App.sidebar.render();
  });

  App.pointModal = { startAddMode, startBendMode, stopMode, openForAdd, openForEdit };
})();
