/* =============================================================================
   main.js
   Bootstrap. Load order:
     1. Try IndexedDB's autosave (storage.js) — the user's actual last
        session in this browser, if any.
     2. If there's nothing there yet, and the page is served over http(s)
        (GitHub Pages or similar — this fetch is blocked by the browser on a
        plain file:// page), try routes.json sitting next to the page.
     3. Otherwise start empty.
   Then render the POI layer and the sidebar/legend. Load this file last —
   it assumes every other module is already in place.
   ============================================================================= */

(function(){
  const { state, utils } = App;

  App.poi.renderAll(); // draws nothing yet, but wires things up before any data arrives

  App.storage.loadAutosave().then(loadedFromAutosave => {
    if(loadedFromAutosave) return; // applySnapshot() already rendered everything

    if(location.protocol !== 'file:'){
      fetch('routes.json').then(r => r.ok ? r.json() : null).then(data => {
        if(data && Array.isArray(data.routes)){
          state.routes = utils.normalizeRoutes(data.routes);
          state.markers = utils.normalizeMarkers(data.markers);
          App.map.renderAll();
          App.poi.renderAll();
        }
        App.sidebar.render();
      }).catch(() => App.sidebar.render());
    } else {
      App.sidebar.render();
    }
  });
})();
