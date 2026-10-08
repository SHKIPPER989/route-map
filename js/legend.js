/* =============================================================================
   legend.js
   A small floating panel on the map itself — color dot + type icon + name
   for every *visible* route — separate from the full sidebar list (which
   carries all the editing controls). Meant as a quick glance reference,
   especially handy when the sidebar is collapsed. Collapsible to a single
   icon button, like the sidebar's own collapse-to-rail.
   ============================================================================= */
//const App = window.App || (window.App = {});

App.legend = {};

(function(){
  const { state, utils } = App;

  const panel       = document.getElementById('routeLegendPanel');
  const listEl       = document.getElementById('routeLegendList');
  const collapseBtn  = document.getElementById('legendCollapseBtn');
  const fab          = document.getElementById('legendFab');

  collapseBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    fab.style.display = 'flex';
  });
  fab.addEventListener('click', () => {
    panel.style.display = 'flex';
    fab.style.display = 'none';
  });

  function render(){
    const visible = state.routes.filter(r => r.visible);
    panel.querySelector('.route-legend-count').textContent = visible.length ? `(${visible.length})` : '';
    if(!visible.length){
      listEl.innerHTML = '<div class="hint" style="padding:6px 2px;">Немає видимих маршрутів</div>';
      return;
    }
    listEl.innerHTML = visible.map(r => `
      <div class="route-legend-item">
        <span class="swatch-dot" style="background:${r.color}"></span>
        <span>${r.type === 'vehicle' ? '🚗' : '🚶'}</span>
        <span class="route-legend-name">${utils.escapeHtml(r.name)}</span>
      </div>
    `).join('');
  }

  App.legend = { render };
})();
