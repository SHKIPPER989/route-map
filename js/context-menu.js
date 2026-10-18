/* =============================================================================
   context-menu.js
   A small right-click menu, shown at the mouse position. It knows nothing about
   routes — callers pass in a title and a list of {icon, label, action}; the
   menu closes itself on any outside click, Esc, window blur/resize/scroll, or
   when the map starts moving/zooming. (map.js uses it for the route line.)
   ============================================================================= */
//const App = window.App || (window.App = {});

App.contextMenu = {};

(function(){
  const { utils } = App;

  let el = null;

  function close(){
    if(el){ el.remove(); el = null; }
  }

  // items: [{icon, label, action, danger?, disabled?}], opts: {title, color}
  // danger = shown in red (destructive action); disabled = greyed out and does nothing.
  function open(x, y, items, opts = {}){
    close();
    el = document.createElement('div');
    el.className = 'ctx-menu';
    el.setAttribute('role', 'menu');

    if(opts.title){
      const head = document.createElement('div');
      head.className = 'ctx-title';
      head.innerHTML = `<span class="swatch-dot" style="background:${utils.escapeHtml(opts.color || '#888')}"></span><span class="ctx-title-text">${utils.escapeHtml(opts.title)}</span>`;
      el.appendChild(head);
    }

    items.forEach(item => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctx-item' + (item.danger ? ' ctx-danger' : '');
      b.setAttribute('role', 'menuitem');
      if(item.disabled) b.disabled = true;
      b.innerHTML = `<span class="ctx-ico">${item.icon || ''}</span><span>${utils.escapeHtml(item.label)}</span>`;
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        close();            // close first, so whatever the action opens (a dialog, a confirm) isn't under the menu
        item.action();
      });
      el.appendChild(b);
    });

    document.body.appendChild(el);

    // Keep the menu fully inside the window (flip/shift near the right and bottom edges).
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    el.style.top  = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';

    const first = el.querySelector('.ctx-item:not(:disabled)');
    if(first) first.focus();
  }

  // A click/press anywhere outside the menu closes it (capture phase, so it happens
  // even where other handlers stop the event). The right-click that opens a new
  // menu closes the previous one first because its mousedown arrives before 'contextmenu'.
  document.addEventListener('mousedown', e => { if(el && !el.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', e => { if(e.key === 'Escape') close(); });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  window.addEventListener('wheel', close, { passive: true });
  App.map.instance.on('movestart zoomstart', close);

  App.contextMenu = { open, close, isOpen: () => !!el };
})();
