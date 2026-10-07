/* =============================================================================
   sidebar.js
   The left-hand panel: route list rendering, creating/deleting routes, tag
   editing, the per-route colour picker, collapse/expand, bulk show/hide,
   and the "show labels" checkbox. Point *creation/editing* lives in
   point-modal.js; this file owns point *deletion* (shared with the map
   popups in map.js) and the points table shown when a route is expanded.
   ============================================================================= */
const App = window.App || (window.App = {});

App.sidebar = {};

(function(){
  const { constants, state, utils } = App;

  const routeListEl    = document.getElementById('routeList');
  const emptyMsg        = document.getElementById('emptyMsg');
  const routeTagsInput  = document.getElementById('routeTags');
  const tagQuickPicks   = document.getElementById('tagQuickPicks');
  const sidebarEl       = document.getElementById('sidebar');

  // ---- tag quick-pick buttons (shown under the "Теги" field) -------------------
  function renderTagQuickPicks(){
    tagQuickPicks.innerHTML = constants.COMMON_TAGS.map(t =>
      `<button type="button" class="tag-chip-btn" data-quicktag="${utils.escapeHtml(t)}">${utils.escapeHtml(t)}</button>`
    ).join('');
  }
  tagQuickPicks.addEventListener('click', e => {
    const btn = e.target.closest('[data-quicktag]');
    if(!btn) return;
    const tag = btn.getAttribute('data-quicktag');
    const current = routeTagsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    if(!current.includes(tag)) current.push(tag);
    routeTagsInput.value = current.join(', ');
  });
  renderTagQuickPicks();

  // ---- sidebar collapse-to-rail -------------------------------------------------
  document.getElementById('collapseBtn').addEventListener('click', () => {
    sidebarEl.classList.add('collapsed');
    setTimeout(() => App.map.instance.invalidateSize(), 230); // let the CSS transition finish first
  });
  document.getElementById('railExpandBtn').addEventListener('click', () => {
    sidebarEl.classList.remove('collapsed');
    setTimeout(() => App.map.instance.invalidateSize(), 230);
  });

  // ---- bulk show/hide --------------------------------------------------------
  document.getElementById('showAllBtn').addEventListener('click', () => {
    state.routes.forEach(r => { r.visible = true; App.map.renderRoute(r); });
    render();
  });
  document.getElementById('hideAllBtn').addEventListener('click', () => {
    state.routes.forEach(r => { r.visible = false; App.map.renderRoute(r); });
    render();
  });

  // ---- "show labels" global toggle -------------------------------------------
  document.getElementById('showLabelsChk').addEventListener('change', e => {
    state.showLabels = e.target.checked;
    App.map.rerenderVisual();
  });

  // ---- route CRUD -------------------------------------------------------------
  document.getElementById('createRouteBtn').addEventListener('click', () => {
    const name = document.getElementById('routeName').value.trim();
    if(!name){ alert('Введіть назву маршруту'); return; }
    const type = document.getElementById('routeType').value;
    const color = document.getElementById('routeColor').value;
    const tags = utils.parseTags(routeTagsInput.value);
    const route = { id: utils.uid('r'), name, type, color, tags, visible: true, points: [], bends: [], _expanded: true };
    state.routes.push(route);
    document.getElementById('routeName').value = '';
    routeTagsInput.value = '';
    render();
    App.pointModal.startAddMode(route.id);
  });

  function deleteRoute(routeId){
    state.routes = state.routes.filter(r => r.id !== routeId);
    App.map.clearRoute(routeId);
    if(state.activeRouteId === routeId) App.pointModal.stopMode();
    render();
  }

  // Shared with map.js (marker popup "видалити" link) and the points table below.
  function deletePoint(routeId, pointId){
    const r = state.routes.find(r => r.id === routeId);
    if(!r) return;
    r.points = r.points.filter(p => p.id !== pointId);
    r.bends = (r.bends || []).filter(b => b.afterPointId !== pointId); // drop now-orphaned bends
    App.map.renderRoute(r);
    render();
  }

  // ---- list rendering -----------------------------------------------------------
  function render(){
    routeListEl.innerHTML = '';
    emptyMsg.style.display = state.routes.length ? 'none' : 'block';

    state.routes.forEach(route => {
      const li = document.createElement('li');
      li.className = 'route-item';

      const bendCount = (route.bends || []).length;
      const bendDisabled = route.points.length < 2;

      const head = document.createElement('div');
      head.className = 'route-head';
      head.innerHTML = `
        <input type="checkbox" ${route.visible ? 'checked' : ''} data-vis="${route.id}">
        <input type="color" class="color-swatch-input" value="${route.color}" data-route-color="${route.id}" title="Змінити колір маршруту">
        <span class="route-name" data-toggle="${route.id}">${route.type === 'vehicle' ? '🚗' : '🚶'} ${utils.escapeHtml(route.name)}
          ${state.activeRouteId === route.id ? '<span class="active-route-flag">активний</span>' : ''}
        </span>
        <span class="route-count">${route.points.length}т.${bendCount ? ' · ' + bendCount + 'к.' : ''}</span>
        <button class="icon-btn" data-add="${route.id}" title="Додати точку кліком по карті">➕</button>
        <button class="icon-btn" data-coord="${route.id}" title="Додати точку за координатами">⌨</button>
        <button class="icon-btn" data-bend="${route.id}" title="Додати коліно (потрібно мінімум 2 точки)" ${bendDisabled ? 'disabled' : ''}>📐</button>
        <button class="icon-btn" data-del-route="${route.id}" title="Видалити маршрут">🗑</button>
      `;
      li.appendChild(head);

      const tagsRow = document.createElement('div');
      tagsRow.className = 'route-tags';
      const badges = (route.tags || []).map(t => `<span class="tag-badge">${utils.escapeHtml(t)}</span>`).join('');
      tagsRow.innerHTML = badges + `<button class="tag-edit-btn" data-edit-tags="${route.id}">✎ теги</button>`;
      li.appendChild(tagsRow);

      if(route._expanded){
        const pts = utils.sortedPoints(route);
        if(pts.length){
          const table = document.createElement('table');
          table.className = 'points-table';
          table.innerHTML = `<tr><th>Дата</th><th>Час</th><th>Дж.</th><th>Примітка</th><th></th></tr>` +
            pts.map(p => `<tr>
                <td>${p.date}</td><td>${p.time}</td>
                <td>${(constants.SOURCE_TYPES[p.sourceType] || constants.SOURCE_TYPES.other).icon}</td>
                <td>${utils.escapeHtml(p.note || '')}</td>
                <td>
                  <button class="icon-btn" data-edit-point-row="${route.id}|${p.id}" title="Редагувати">✎</button>
                  <button class="icon-btn" data-del-point-row="${route.id}|${p.id}" title="Видалити">✕</button>
                </td>
              </tr>`).join('');
          li.appendChild(table);
        } else {
          const d = document.createElement('div');
          d.className = 'hint';
          d.style.padding = '0 16px 10px';
          d.textContent = 'Точок ще немає.';
          li.appendChild(d);
        }
      }

      routeListEl.appendChild(li);
    });
  }

  // ---- list click/edit event delegation -----------------------------------------
  routeListEl.addEventListener('click', e => {
    const vis          = e.target.closest('[data-vis]');
    const toggle        = e.target.closest('[data-toggle]');
    const addBtn        = e.target.closest('[data-add]');
    const coordBtn       = e.target.closest('[data-coord]');
    const bendBtn        = e.target.closest('[data-bend]');
    const delRoute       = e.target.closest('[data-del-route]');
    const delPointRow    = e.target.closest('[data-del-point-row]');
    const editPointRow   = e.target.closest('[data-edit-point-row]');
    const editTags        = e.target.closest('[data-edit-tags]');

    if(vis){
      const r = state.routes.find(r => r.id === vis.getAttribute('data-vis'));
      r.visible = vis.checked;
      App.map.renderRoute(r);
    }
    if(toggle){
      const r = state.routes.find(r => r.id === toggle.getAttribute('data-toggle'));
      r._expanded = !r._expanded;
      render();
    }
    if(addBtn) App.pointModal.startAddMode(addBtn.getAttribute('data-add'));
    if(coordBtn){
      App.pointModal.startAddMode(coordBtn.getAttribute('data-coord'));
      App.pointModal.openForAdd(null); // null => manual coordinate entry, no map click needed
    }
    if(bendBtn && !bendBtn.disabled) App.pointModal.startBendMode(bendBtn.getAttribute('data-bend'));
    if(delRoute && confirm('Видалити маршрут разом з усіма точками?')) deleteRoute(delRoute.getAttribute('data-del-route'));
    if(delPointRow){
      const [routeId, pointId] = delPointRow.getAttribute('data-del-point-row').split('|');
      deletePoint(routeId, pointId);
    }
    if(editPointRow){
      const [routeId, pointId] = editPointRow.getAttribute('data-edit-point-row').split('|');
      App.pointModal.openForEdit(routeId, pointId);
    }
    if(editTags){
      const r = state.routes.find(r => r.id === editTags.getAttribute('data-edit-tags'));
      const input = prompt("Теги через кому (напр. Свідок, Кур'єр):", (r.tags || []).join(', '));
      if(input !== null){ r.tags = utils.parseTags(input); render(); }
    }
  });

  // Colour change: update the map live without rebuilding the whole list —
  // rebuilding mid-drag would steal focus from the native colour picker.
  routeListEl.addEventListener('input', e => {
    const colorInput = e.target.closest('[data-route-color]');
    if(colorInput){
      const r = state.routes.find(r => r.id === colorInput.getAttribute('data-route-color'));
      if(r){ r.color = colorInput.value; App.map.renderRoute(r); }
    }
  });

  App.sidebar = { render, deletePoint, deleteRoute };
})();
