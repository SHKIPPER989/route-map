/* =============================================================================
   state.js
   The single in-memory data model (App.state) plus small pure helper
   functions (App.utils). Nothing in this file touches the DOM or Leaflet —
   keeping it that way means the data model stays trivial to export/import
   and easy to reason about as new features get added.
   ============================================================================= */
//const App = window.App || (window.App = {});

// ---- data model -------------------------------------------------------------
// route:  {id, name, type:'pedestrian'|'vehicle', color, tags:[...], visible,
//          points:[{id,lat,lng,date,time,sourceType,note,photo,photoCard}],
//          bends:[{id,lat,lng,afterPointId}]}
//   "bends" = коліна (curve waypoints). Each bend hangs off the fixation point
//   it follows (afterPointId); bends of the same point are drawn in ARRAY
//   order, so the order of route.bends is meaningful — never re-sort it.
//   photoCard = {dx, dy, w, hidden}: where the on-map photo card sits relative
//   to its point (pixels), its width, and whether the user closed it.
// marker: {id, icon:'home'|'car'|'suspect'|'hazard'|'camera'|'flag'|'other',
//          label, lat, lng, note}                 // standalone map icon (poi.js)
App.state = {
  routes: [],
  markers: [],            // standalone POI markers — see poi.js
  activeRouteId: null,     // route currently receiving clicked points/bends
  mode: null,              // null | 'point' | 'bend'  (what a map click currently does)
  editingPointId: null,    // {routeId, pointId} while the modal is editing an existing point
  showLabels: false,       // global toggle: permanent date/time/tag labels under points
  showMarkerLabels: false, // global toggle: permanent name labels under POI markers
  showPhotos: true,        // global toggle: photo cards next to points (photo-cards.js)
  poiPlacing: null         // true while waiting for a map click to place a new POI marker
};

App.utils = {
  uid(prefix){ return prefix + Date.now() + '-' + Math.floor(Math.random() * 10000); },

  escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  },

  parseTags(str){
    return (str || '').split(',').map(s => s.trim()).filter(Boolean);
  },

  // Picks the first two decimal numbers out of arbitrary pasted text, so
  // "49.5535, 25.5948", "49.5535 25.5948" and text with extra words/symbols
  // around the numbers all work. Shared by the point modal and the POI
  // marker modal's "paste coordinates" field.
  parseCoordsFromText(text){
    const matches = (text.match(/-?\d+(?:[.,]\d+)?/g) || []).map(s => parseFloat(s.replace(',', '.')));
    if(matches.length >= 2 && isFinite(matches[0]) && isFinite(matches[1])) return { lat: matches[0], lng: matches[1] };
    return null;
  },

  // Older saves stored a numeric `t` on every bend and sorted by it. Bends are
  // now simply ordered by array position, so convert once on load: group by
  // the point they follow, sort each group by `t`, drop `t`.
  orderLegacyBends(bends){
    if(!bends.some(b => typeof b.t === 'number')) return bends;
    const anchors = [];
    bends.forEach(b => { if(!anchors.includes(b.afterPointId)) anchors.push(b.afterPointId); });
    const out = [];
    anchors.forEach(a => out.push(...bends.filter(b => b.afterPointId === a).sort((x, y) => (x.t || 0) - (y.t || 0))));
    return out.map(({ t, ...b }) => b);
  },

  // Fills in defaults for routes/points loaded from an older JSON export (or
  // a saved browser "plan") so newer fields never come back as `undefined`
  // and break rendering.
  normalizeRoutes(list){
    return (list || []).map(r => ({
      visible: true, tags: [],
      ...r,
      bends: App.utils.orderLegacyBends(r.bends || []),
      points: (r.points || []).map(p => ({ sourceType: 'other', photo: null, ...p }))
    }));
  },

  normalizeMarkers(list){
    return (list || []).map(m => ({ icon: 'other', note: '', ...m }));
  },

  sortedPoints(route){
    return [...route.points].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },

  // The route as one ordered chain of nodes: each fixation point (by time),
  // immediately followed by the bends that hang off it (in array order).
  // This chain IS the drawn line — used for the polyline, the arrow
  // decorator, and for finding which line segment a new bend belongs in.
  buildNodes(route){
    const bends = route.bends || [];
    const nodes = [];
    App.utils.sortedPoints(route).forEach(p => {
      nodes.push({ kind: 'point', id: p.id, lat: p.lat, lng: p.lng, anchorId: p.id });
      bends.filter(b => b.afterPointId === p.id)
           .forEach(b => nodes.push({ kind: 'bend', id: b.id, lat: b.lat, lng: b.lng, anchorId: p.id }));
    });
    return nodes;
  },

  buildPathLatLngs(route){
    return App.utils.buildNodes(route).map(n => [n.lat, n.lng]);
  }
};
