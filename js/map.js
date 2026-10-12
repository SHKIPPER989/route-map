/* =============================================================================
   map.js
   Everything Leaflet-related: base map/tile setup, marker clustering,
   drawing a route (point markers + polyline + direction arrows + "bend"
   waypoints), the geometry used to drop a bend onto the line where it was
   clicked, draggable points/bends, and the permanent on-map point labels.
   Standalone POI markers (Будинок/Авто/... ) are a separate layer — see poi.js.
   Photo cards shown next to points are built by photo-cards.js.
   ============================================================================= */
//const App = window.App || (window.App = {});

App.map = {}; // filled in at the bottom of this IIFE

(function(){
  const { constants, state, utils } = App;

  // ---- base map -------------------------------------------------------------
  const map = L.map('map', { zoomControl: true }).setView([50.4501, 30.5234], 12); // default view: Kyiv
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  navigator.geolocation && navigator.geolocation.getCurrentPosition(
    pos => map.setView([pos.coords.latitude, pos.coords.longitude], 13),
    () => {}, { timeout: 2000 }
  );

  // All fixation-point markers (across every route) live in one shared
  // cluster group, so nearby points group together into a single bubble
  // when zoomed out — useful once a route has many points. Lines, arrow
  // decorators and "bend" markers are geometry, not individual fixations, so
  // they stay outside the cluster, in a plain per-route layer group.
  const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 });
  map.addLayer(clusterGroup);

  const layerByRoute = {};   // routeId -> L.LayerGroup (polyline + decorator + bend markers)
  const markersByRoute = {}; // routeId -> [L.Marker, ...] this route's point markers in clusterGroup

  // ---- marker icons ------------------------------------------------------------
  // The point icon is a 22px circle; when the point has a visible photo, the
  // photo card (+ its leader line) is appended INSIDE the same icon element,
  // so it moves, clusters and zooms together with the point.
  function makeDivIcon(route, point){
    const icon = (constants.SOURCE_TYPES[point && point.sourceType] || constants.SOURCE_TYPES.other).icon;
    const card = App.photoCards ? App.photoCards.html(route, point) : '';
    return L.divIcon({
      className: 'leaflet-div-icon',
      html: `<div class="pt-icon" style="background:${route.color}">${icon}</div>${card}`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  // Small plain dot used for "bend" waypoints — a real L.marker (not
  // L.circleMarker) so it can be dragged like any other marker.
  function makeBendIcon(route){
    return L.divIcon({
      className: 'leaflet-div-icon',
      html: `<div class="bend-dot" style="background:${route.color}"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
  }

  function popupHtml(route, p){
    const src = constants.SOURCE_TYPES[p.sourceType] || constants.SOURCE_TYPES.other;
    const cardShown = App.photoCards && App.photoCards.isShown(p);
    // The thumbnail is only needed in the popup while the photo card itself isn't on the map.
    const photo = (p.photo && !cardShown)
      ? `<br><img src="${utils.escapeHtml(p.photo)}" style="max-width:160px;max-height:120px;border-radius:4px;margin-top:4px;">` : '';
    const photoToggle = p.photo
      ? `<br><a href="#" data-toggle-photo="${route.id}|${p.id}">${p.photoCard && p.photoCard.hidden ? 'показати' : 'сховати'} фото на карті</a>` : '';
    return `<b>${route.type === 'vehicle' ? '🚗' : '🚶'} ${utils.escapeHtml(route.name)}</b><br>` +
      `${src.icon} ${src.label}<br>${p.date} ${p.time}` +
      (p.note ? `<br><i>${utils.escapeHtml(p.note)}</i>` : '') + photo + photoToggle +
      `<br><span class="hint">Перетягніть мітку, щоб уточнити координати</span>` +
      `<br><a href="#" data-edit-point="${route.id}|${p.id}">редагувати</a> · ` +
      `<a href="#" data-del-point="${route.id}|${p.id}" style="color:#c00;">видалити</a>`;
  }

  // Permanent label shown under a marker when "Показувати підписи" is on —
  // combines the route's tags (the "collective" context) with this point's
  // own date/time (the "individual" detail), per the request.
  function pointLabelHtml(route, p){
    const tagPart = (route.tags || []).length ? utils.escapeHtml(route.tags.join(', ')) + ' · ' : '';
    return `${tagPart}${p.date} ${p.time}`;
  }

  // ---- "bend" (коліно) geometry ------------------------------------------------
  // Distance (in screen pixels) from point p to the segment v-w, plus the
  // closest point on that segment.
  function distToSegment(p, v, w){
    const dx = w.x - v.x, dy = w.y - v.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((p.x - v.x) * dx + (p.y - v.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const x = v.x + t * dx, y = v.y + t * dy;
    return { dist: Math.hypot(p.x - x, p.y - y), x, y };
  }

  // Finds the piece of the *drawn* line (points AND already-placed bends)
  // that is closest to the click, and returns the node it starts at plus the
  // closest spot on it. Using the real line — not the straight chord between
  // two fixation points — is what keeps curved / hairpin streets in the right
  // order when several bends are added. Ties go to the earlier segment (the
  // epsilon keeps floating-point noise from deciding it).
  function nearestPathSegment(route, latlng){
    const nodes = utils.buildNodes(route);
    if(nodes.length < 2) return null;
    const clickPx = map.latLngToLayerPoint(latlng);
    let best = null;
    for(let i = 0; i < nodes.length - 1; i++){
      const d = distToSegment(clickPx,
        map.latLngToLayerPoint([nodes[i].lat, nodes[i].lng]),
        map.latLngToLayerPoint([nodes[i + 1].lat, nodes[i + 1].lng]));
      if(!best || d.dist < best.dist - 1e-6) best = { dist: d.dist, prev: nodes[i], x: d.x, y: d.y };
    }
    return best;
  }

  // Adds a bend where the user clicked ON the route line (see the invisible
  // "hit line" in renderRoute — no special mode needed). The bend is snapped
  // onto the line itself, so adding it doesn't change the route's shape; the
  // user then drags it to bend the line, like vertices in Google My Maps.
  // It is spliced into route.bends right after the node it follows, so array
  // order always equals drawing order.
  function addBend(route, latlng){
    const seg = nearestPathSegment(route, latlng);
    if(!seg) return;
    const at = map.layerPointToLatLng(L.point(seg.x, seg.y));
    route.bends = route.bends || [];
    const prev = seg.prev;
    const bend = { id: utils.uid('b'), lat: at.lat, lng: at.lng, afterPointId: prev.anchorId };
    let idx;
    if(prev.kind === 'bend') idx = route.bends.findIndex(b => b.id === prev.id) + 1;   // right after the previous bend
    else {                                                                              // right after the point itself,
      idx = route.bends.findIndex(b => b.afterPointId === prev.id);                     // i.e. before its other bends
      if(idx === -1) idx = route.bends.length;
    }
    route.bends.splice(idx, 0, bend);
    renderRoute(route);
    App.sidebar.render();
  }

  function deleteBend(routeId, bendId){
    const r = state.routes.find(r => r.id === routeId);
    if(!r) return;
    r.bends = (r.bends || []).filter(b => b.id !== bendId);
    renderRoute(r);
    App.sidebar.render();
  }

  // ---- rendering ----------------------------------------------------------------
  // Fully redraws one route's markers + line + bends from its current data.
  // Safe to call after any edit (add/delete point, move bend, recolor, etc).
  function renderRoute(route){
    clearRoute(route.id);
    if(!route.visible) return;

    const pts = utils.sortedPoints(route);

    // Point markers go into the shared cluster group. Draggable: dropping a
    // marker updates that point's stored coordinates on dragend. Points with a
    // visible photo card get a z-index boost so the card sits above other markers.
    const newMarkers = pts.map(p => {
      const marker = L.marker([p.lat, p.lng], {
        icon: makeDivIcon(route, p), draggable: true,
        zIndexOffset: (App.photoCards && App.photoCards.isShown(p)) ? 1000 : 0
      });
      marker.bindPopup(popupHtml(route, p));
      if(state.showLabels){
        marker.bindTooltip(pointLabelHtml(route, p), { permanent: true, direction: 'bottom', className: 'point-label', offset: [0, 10] });
      }
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        p.lat = ll.lat; p.lng = ll.lng;
        renderRoute(route); // redraw so the line/arrows follow the moved point
        App.sidebar.render();
      });
      return marker;
    });
    clusterGroup.addLayers(newMarkers);
    markersByRoute[route.id] = newMarkers;
    if(App.photoCards) App.photoCards.schedule(); // fix leader lines once the new icons are laid out

    // Line, direction arrows and bend markers go into this route's own layer group.
    const group = L.layerGroup();

    (route.bends || []).forEach(b => {
      const bendMarker = L.marker([b.lat, b.lng], { icon: makeBendIcon(route), draggable: true });
      bendMarker.bindPopup(`<b>Коліно</b><br><span class="hint">Перетягніть, щоб уточнити форму кривої</span><br><a href="#" data-del-bend="${route.id}|${b.id}" style="color:#c00;">видалити коліно</a>`);
      bendMarker.on('dragend', () => {
        const ll = bendMarker.getLatLng();
        b.lat = ll.lat; b.lng = ll.lng;
        renderRoute(route);
        App.storage.autosave();
      });
      group.addLayer(bendMarker);
    });

    if(pts.length >= 2){
      const latlngs = utils.buildPathLatLngs(route);
      const line = L.polyline(latlngs, { color: route.color, weight: 3, opacity: 0.85 });
      group.addLayer(line);
      group.addLayer(L.polylineDecorator(line, {
        patterns: [{
          offset: '5%', repeat: '80px',
          symbol: L.Symbol.arrowHead({ pixelSize: 10, polygon: false, pathOptions: { stroke: true, color: route.color, weight: 2, interactive: false } })
        }]
      }));

      // Invisible, much wider twin of the line: a generous click target so the
      // thin line is easy to hit. A click on it adds a bend. While "add point"
      // or "place marker" is active, clicks keep their normal meaning instead
      // (let them through to the map).
      // (opacity 0.01, not 0: invisible, but still counts as "painted" for SVG click hit-testing)
      const hit = L.polyline(latlngs, { weight: 16, opacity: 0.01, className: 'route-hit-line' });
      hit.on('click', e => {
        if(state.mode === 'point' || state.poiPlacing) return;
        L.DomEvent.stopPropagation(e);
        addBend(route, e.latlng);
      });
      group.addLayer(hit);
    }

    group.addTo(map);
    layerByRoute[route.id] = group;
  }

  // Removes a route's layers from the map without touching its data —
  // used both at the start of renderRoute() and when a route is deleted.
  function clearRoute(routeId){
    if(layerByRoute[routeId]){ map.removeLayer(layerByRoute[routeId]); delete layerByRoute[routeId]; }
    if(markersByRoute[routeId]){ clusterGroup.removeLayers(markersByRoute[routeId]); delete markersByRoute[routeId]; }
  }

  // Redraws every route. First removes the layers of routes that are no longer
  // in the data (after undo, a JSON import or loading a plan) — otherwise the old
  // routes would stay on the map as ghosts.
  function renderAll(){
    const alive = new Set(state.routes.map(r => r.id));
    Object.keys(layerByRoute).concat(Object.keys(markersByRoute)).forEach(id => { if(!alive.has(id)) clearRoute(id); });
    state.routes.forEach(renderRoute);
  }

  // Re-draws every visible route's layers without changing any data — used
  // when a "show labels" / "show photos" checkbox is toggled.
  function rerenderVisual(){ renderAll(); }

  // Popup contents are plain HTML strings, so their action links (edit/delete
  // point, delete bend, show/hide photo) are wired via delegation each time a popup opens.
  map.on('popupopen', e => {
    const el = e.popup.getElement();
    el.querySelectorAll('[data-del-point]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const [routeId, pointId] = a.getAttribute('data-del-point').split('|');
      App.sidebar.deletePoint(routeId, pointId);
      map.closePopup();
    }));
    el.querySelectorAll('[data-edit-point]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const [routeId, pointId] = a.getAttribute('data-edit-point').split('|');
      App.pointModal.openForEdit(routeId, pointId);
      map.closePopup();
    }));
    el.querySelectorAll('[data-del-bend]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const [routeId, bendId] = a.getAttribute('data-del-bend').split('|');
      deleteBend(routeId, bendId);
      map.closePopup();
    }));
    el.querySelectorAll('[data-toggle-photo]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const [routeId, pointId] = a.getAttribute('data-toggle-photo').split('|');
      App.photoCards.toggle(routeId, pointId);
      map.closePopup();
    }));
  });

  // Map clicks only do something while an "add point" mode is active (started
  // from the sidebar — see point-modal.js), or while placing a new POI marker
  // (see poi.js). Bends are added by clicking the route line itself (renderRoute).
  map.on('click', e => {
    if(state.poiPlacing){ App.poi.placeAt(e.latlng); return; }
    if(state.activeRouteId && state.mode === 'point') App.pointModal.openForAdd(e.latlng);
  });

  App.map = { instance: map, renderRoute, renderAll, rerenderVisual, clearRoute, deleteBend };
})();
