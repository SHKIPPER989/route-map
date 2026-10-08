/* =============================================================================
   map.js
   Everything Leaflet-related: base map/tile setup, marker clustering,
   drawing a route (point markers + polyline + direction arrows + "bend"
   waypoints), the point-to-segment math used to drop a bend on the nearest
   piece of line, and the permanent on-map point labels.
   ============================================================================= */

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
  // decorators and "bend" dots are geometry, not individual fixations, so
  // they stay outside the cluster, in a plain per-route layer group.
  const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 });
  map.addLayer(clusterGroup);

  const layerByRoute = {};   // routeId -> L.LayerGroup (polyline + decorator + bend dots)
  const markersByRoute = {}; // routeId -> [L.Marker, ...] this route's markers in clusterGroup

  // ---- marker icon ------------------------------------------------------------
  function makeDivIcon(route, point){
    const icon = (constants.SOURCE_TYPES[point && point.sourceType] || constants.SOURCE_TYPES.other).icon;
    return L.divIcon({
      className: 'leaflet-div-icon',
      html: `<div class="pt-icon" style="background:${route.color}">${icon}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  function popupHtml(route, p){
    const src = constants.SOURCE_TYPES[p.sourceType] || constants.SOURCE_TYPES.other;
    const photo = p.photo ? `<br><img src="${p.photo}" style="max-width:160px;max-height:120px;border-radius:4px;margin-top:4px;">` : '';
    return `<b>${route.type === 'vehicle' ? '🚗' : '🚶'} ${utils.escapeHtml(route.name)}</b><br>` +
      `${src.icon} ${src.label}<br>${p.date} ${p.time}` +
      (p.note ? `<br><i>${utils.escapeHtml(p.note)}</i>` : '') + photo +
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

  // ---- "bend" (коліно) geometry helpers ----------------------------------------
  // Distance from point p to segment v-w in pixel space, plus the projection
  // fraction t (0 = at v, 1 = at w), used to order multiple bends that land
  // on the same segment so the curve looks right.
  function distToSegmentT(p, v, w){
    const dx = w.x - v.x, dy = w.y - v.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((p.x - v.x) * dx + (p.y - v.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = v.x + t * dx, projY = v.y + t * dy;
    return { dist: Math.hypot(p.x - projX, p.y - projY), t };
  }

  function nearestPointSegment(route, latlng){
    const pts = utils.sortedPoints(route);
    if(pts.length < 2) return null;
    const clickPx = map.latLngToLayerPoint(latlng);
    let best = null;
    for(let i = 0; i < pts.length - 1; i++){
      const vPx = map.latLngToLayerPoint([pts[i].lat, pts[i].lng]);
      const wPx = map.latLngToLayerPoint([pts[i + 1].lat, pts[i + 1].lng]);
      const r = distToSegmentT(clickPx, vPx, wPx);
      if(!best || r.dist < best.dist) best = { dist: r.dist, t: r.t, idx: i };
    }
    return best;
  }

  function addBendAtLatLng(latlng){
    const r = state.routes.find(r => r.id === state.activeRouteId);
    if(!r) return;
    const seg = nearestPointSegment(r, latlng);
    if(!seg) return; // shouldn't happen — the "add bend" button is disabled below 2 points
    const pts = utils.sortedPoints(r);
    r.bends = r.bends || [];
    r.bends.push({ id: utils.uid('b'), lat: latlng.lat, lng: latlng.lng, afterPointId: pts[seg.idx].id, t: seg.t });
    renderRoute(r);
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

    // Point markers go into the shared cluster group.
    const newMarkers = pts.map(p => {
      const marker = L.marker([p.lat, p.lng], { icon: makeDivIcon(route, p) });
      marker.bindPopup(popupHtml(route, p));
      if(state.showLabels){
        marker.bindTooltip(pointLabelHtml(route, p), { permanent: true, direction: 'bottom', className: 'point-label', offset: [0, 10] });
      }
      return marker;
    });
    clusterGroup.addLayers(newMarkers);
    markersByRoute[route.id] = newMarkers;

    // Line, direction arrows and bend dots go into this route's own layer group.
    const group = L.layerGroup();

    (route.bends || []).forEach(b => {
      const bendMarker = L.circleMarker([b.lat, b.lng], { radius: 5, color: '#fff', weight: 2, fillColor: route.color, fillOpacity: 1 });
      bendMarker.bindPopup(`<b>Коліно</b><br><a href="#" data-del-bend="${route.id}|${b.id}" style="color:#c00;">видалити коліно</a>`);
      group.addLayer(bendMarker);
    });

    if(pts.length >= 2){
      const latlngs = utils.buildPathLatLngs(route);
      const line = L.polyline(latlngs, { color: route.color, weight: 3, opacity: 0.85 });
      group.addLayer(line);
      group.addLayer(L.polylineDecorator(line, {
        patterns: [{
          offset: '5%', repeat: '80px',
          symbol: L.Symbol.arrowHead({ pixelSize: 10, polygon: false, pathOptions: { stroke: true, color: route.color, weight: 2 } })
        }]
      }));
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

  function renderAll(){ state.routes.forEach(renderRoute); }

  // Re-draws every visible route's layers without changing any data — used
  // when the "show labels" checkbox is toggled.
  function rerenderVisual(){ renderAll(); }

  // Popup contents are plain HTML strings, so their action links (edit/delete
  // point, delete bend) need to be wired via delegation each time a popup opens.
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
  });

  // Map clicks only do something while an "add point" or "add bend" mode is
  // active (started from the sidebar — see point-modal.js).
  map.on('click', e => {
    if(!state.activeRouteId) return;
    if(state.mode === 'point') App.pointModal.openForAdd(e.latlng);
    else if(state.mode === 'bend') addBendAtLatLng(e.latlng);
  });

  App.map = { instance: map, renderRoute, renderAll, rerenderVisual, clearRoute, deleteBend };
})();
