/* =============================================================================
   main.js
   Bootstrap. Loads any routes.json sitting next to the page (works on
   GitHub Pages / any http(s) host — this fetch is blocked by the browser on
   a plain file:// page, hence the protocol check), then does the first
   render. Load this file last — it assumes every other module is in place.
   ============================================================================= */

(function(){
  const { state, utils } = App;

  if(location.protocol !== 'file:'){
    fetch('routes.json').then(r => r.ok ? r.json() : null).then(data => {
      if(data && Array.isArray(data.routes)){
        state.routes = utils.normalizeRoutes(data.routes);
        App.map.renderAll();
        App.sidebar.render();
      }
    }).catch(() => {});
  }

  App.sidebar.render();
})();
