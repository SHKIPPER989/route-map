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
//          points:[{id,lat,lng,date,time,sourceType,note,photo}],
//          bends:[{id,lat,lng,afterPointId,t}]}   // "bends" = коліна (curve waypoints)
// marker: {id, icon:'home'|'car'|'suspect'|'hazard'|'camera'|'flag'|'other',
//          label, lat, lng, note}                 // standalone map icon (poi.js)
App.state = {
  routes: [],
  markers: [],           // standalone POI markers — see poi.js
  activeRouteId: null,    // route currently receiving clicked points/bends
  mode: null,             // null | 'point' | 'bend'  (what a map click currently does)
  editingPointId: null,   // {routeId, pointId} while the modal is editing an existing point
  showLabels: false,      // global toggle: permanent date/time/tag labels under points
  showMarkerLabels: false, // global toggle: permanent name labels under POI markers
  poiPlacing: null         // {icon, label, note} while waiting for a map click to place a new POI marker
};

App.utils = {
  uid(prefix){ return prefix + Date.now() + '-' + Math.floor(Math.random() * 10000); },

  escapeHtml(s){
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
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

  // Fills in defaults for routes/points loaded from an older JSON export (or
  // a saved browser "plan") so newer fields never come back as `undefined`
  // and break rendering.
  normalizeRoutes(list){
    return (list || []).map(r => ({
      visible: true, tags: [], bends: [],
      ...r,
      points: (r.points || []).map(p => ({ sourceType: 'other', photo: null, ...p }))
    }));
  },

  normalizeMarkers(list){
    return (list || []).map(m => ({ icon: 'other', note: '', ...m }));
  },

  sortedPoints(route){
    return [...route.points].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },

  // Interleaves a route's fixation points and "bend" waypoints into one
  // ordered lat/lng path, used both for the drawn polyline and the arrow
  // decorator — this is what makes curved streets possible.
  buildPathLatLngs(route){
    const pts = App.utils.sortedPoints(route);
    const bends = route.bends || [];
    const latlngs = [];
    pts.forEach(p => {
      latlngs.push([p.lat, p.lng]);
      bends.filter(b => b.afterPointId === p.id)
           .sort((a, b) => (a.t || 0) - (b.t || 0))
           .forEach(b => latlngs.push([b.lat, b.lng]));
    });
    return latlngs;
  }
};
