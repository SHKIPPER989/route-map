/* =============================================================================
   state.js
   The single in-memory data model (App.state.routes) plus small pure helper
   functions (App.utils). Nothing in this file touches the DOM or Leaflet —
   keeping it that way means the data model stays trivial to export/import
   and easy to reason about as new features get added.
   ============================================================================= */
const App = window.App || (window.App = {});

// ---- data model -------------------------------------------------------------
// route: {id, name, type:'pedestrian'|'vehicle', color, tags:[...], visible,
//         points:[{id,lat,lng,date,time,sourceType,note,photo}],
//         bends:[{id,lat,lng,afterPointId,t}]}   // "bends" = коліна (curve waypoints)
App.state = {
  routes: [],
  activeRouteId: null,   // route currently receiving clicked points/bends
  mode: null,            // null | 'point' | 'bend'  (what a map click currently does)
  editingPointId: null,  // {routeId, pointId} while the modal is editing an existing point
  showLabels: false      // global toggle: permanent date/time/tag labels under points
};

App.utils = {
  uid(prefix){ return prefix + Date.now() + '-' + Math.floor(Math.random() * 10000); },

  escapeHtml(s){
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  },

  parseTags(str){
    return (str || '').split(',').map(s => s.trim()).filter(Boolean);
  },

  // Fills in defaults for routes/points loaded from an older JSON export so
  // newer fields (tags, bends, sourceType, photo, ...) never come back as
  // `undefined` and break rendering.
  normalizeRoutes(list){
    return list.map(r => ({
      visible: true, tags: [], bends: [],
      ...r,
      points: (r.points || []).map(p => ({ sourceType: 'other', photo: null, ...p }))
    }));
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
