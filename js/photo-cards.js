/* =============================================================================
   photo-cards.js
   Shows the photo/scan attached to a fixation point as a small "photo print"
   card on the map, joined to its point by a leader line. The card can be
   dragged anywhere and resized by its corner grip — the line follows, so the
   card never loses its link to the point.
   How it works:
     - map.js asks html(route, point) for the card markup and appends it INSIDE
       the point's marker icon. The card is positioned relative to the point's
       centre (p.photoCard = {dx, dy, w}), so it pans/zooms/clusters with the point.
     - All mouse/touch handling is delegated from the map container in the
       CAPTURE phase and stops the event there, so dragging a card never pans
       the map, drags the marker, opens its popup or triggers a double-click zoom.
     - Position/size are saved on the point (and autosaved) when the drag ends.
   ============================================================================= */
//const App = window.App || (window.App = {});

App.photoCards = {};

(function(){
  const { state, utils } = App;

  const CENTER = 11;                       // half of the 22px point icon: card offsets are measured from the point's centre
  const DEFAULTS = { dx: 28, dy: -130, w: 140 };
  const MIN_W = 70, MAX_W = 640;

  const container = App.map.instance.getContainer();

  // The card's saved layout, filled with defaults the first time it's needed.
  function layout(p){
    const c = p.photoCard || (p.photoCard = {});
    if(typeof c.dx !== 'number') c.dx = DEFAULTS.dx;
    if(typeof c.dy !== 'number') c.dy = DEFAULTS.dy;
    if(typeof c.w  !== 'number') c.w  = DEFAULTS.w;
    return c;
  }

  // A card is drawn when: global "show photos" is on, the point has a photo,
  // and the user hasn't closed this particular card.
  function isShown(p){
    return !!(state.showPhotos && p.photo && !(p.photoCard && p.photoCard.hidden));
  }

  // ---- markup -----------------------------------------------------------------
  // Order matters for stacking: leader line (bottom), point circle (middle, see
  // .pt-icon in styles.css), card (top). The line's end is a rough guess until
  // the image has loaded — updateLeader() corrects it from the real card size.
  function html(route, p){
    if(!isShown(p)) return '';
    const c = layout(p);
    return `<svg class="pc-leader"><line x1="0" y1="0" x2="${c.dx + c.w / 2}" y2="${c.dy + 40}" stroke="${route.color}" stroke-width="2"/></svg>` +
      `<div class="photo-card" data-route="${route.id}" data-point="${p.id}" ` +
        `style="left:${CENTER + c.dx}px;top:${CENTER + c.dy}px;width:${c.w}px;border-color:${route.color}">` +
        `<img src="${utils.escapeHtml(p.photo)}" alt="" draggable="false">` +
        `<button type="button" class="pc-close" title="Сховати фото">✕</button>` +
        `<span class="pc-grip" title="Потягніть, щоб змінити розмір"></span>` +
      `</div>`;
  }

  // ---- leader line ----------------------------------------------------------------
  // The line runs from the point's centre to the centre of the card; the card
  // is drawn above it, so the line appears to enter the card at its border.
  function updateLeader(el){
    const holder = el.parentElement;
    const line = holder && holder.querySelector('.pc-leader line');
    if(!line) return;
    line.setAttribute('x2', parseFloat(el.style.left) - CENTER + el.offsetWidth / 2);
    line.setAttribute('y2', parseFloat(el.style.top)  - CENTER + el.offsetHeight / 2);
  }
  function updateAll(){ container.querySelectorAll('.photo-card').forEach(updateLeader); }

  let scheduled = false;
  function schedule(){
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; updateAll(); });
  }
  // Marker icons are recreated whenever clusters open/close, so re-measure then.
  App.map.instance.on('layeradd zoomend moveend', schedule);
  // Natural size is only known once the image has loaded; a broken image
  // (e.g. a link to a PDF) falls back to a plain "open attachment" link.
  container.addEventListener('load', e => {
    const card = e.target.closest && e.target.closest('.photo-card');
    if(card) updateLeader(card);
  }, true);
  container.addEventListener('error', e => {
    const img = e.target;
    if(!(img instanceof HTMLImageElement) || !img.closest('.photo-card')) return;
    const a = document.createElement('a');
    a.href = img.src; a.target = '_blank'; a.rel = 'noopener'; a.className = 'pc-fallback';
    a.textContent = '📄 Відкрити вкладення';
    img.replaceWith(a);
    schedule();
  }, true);

  // ---- data lookups & show/hide ---------------------------------------------------
  function find(routeId, pointId){
    const route = state.routes.find(r => r.id === routeId);
    const point = route && route.points.find(p => p.id === pointId);
    return point ? { route, point } : null;
  }

  function setHidden(routeId, pointId, hidden){
    const f = find(routeId, pointId);
    if(!f) return;
    layout(f.point).hidden = hidden;
    App.map.renderRoute(f.route);
    App.sidebar.render();
  }
  function toggle(routeId, pointId){
    const f = find(routeId, pointId);
    if(f) setHidden(routeId, pointId, !(f.point.photoCard && f.point.photoCard.hidden));
  }

  // Global "Показувати фото біля точок" checkbox.
  const chk = document.getElementById('showPhotosChk');
  chk.checked = state.showPhotos;
  chk.addEventListener('change', () => {
    state.showPhotos = chk.checked;
    App.map.rerenderVisual();
  });

  // ---- mouse / touch handling (delegated, capture phase) --------------------------
  // Leaflet and the marker's own dragging listen for these on the map container
  // or the icon; stopping them here (before they get there) keeps the card isolated.
  const inCard = e => (e.target.closest ? e.target.closest('.photo-card') : null);

  ['dblclick', 'contextmenu', 'mousedown', 'mouseup', 'touchstart'].forEach(type =>
    container.addEventListener(type, e => { if(inCard(e)) e.stopPropagation(); }, true));

  container.addEventListener('click', e => {
    const card = inCard(e);
    if(!card) return;
    e.stopPropagation(); // don't let the map/marker see it (no popup, no add-point click)
    if(e.target.closest('.pc-close')) setHidden(card.dataset.route, card.dataset.point, true);
  }, true);

  let drag = null;   // {el, c, resizing, x0, y0, dx0, dy0, w0, pointerId}
  let zTop = 100000; // raises the touched card's marker above its neighbours

  container.addEventListener('pointerdown', e => {
    const el = inCard(e);
    if(!el) return;
    e.stopPropagation();
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    if(e.target.closest('.pc-close') || e.target.closest('a')) return; // let buttons/links behave normally
    const f = find(el.dataset.route, el.dataset.point);
    if(!f) return;
    const c = layout(f.point);
    drag = {
      el, c, resizing: !!e.target.closest('.pc-grip'),
      x0: e.clientX, y0: e.clientY, dx0: c.dx, dy0: c.dy, w0: c.w, pointerId: e.pointerId
    };
    try { el.setPointerCapture(e.pointerId); } catch(err) {}
    const icon = el.closest('.leaflet-marker-icon');
    if(icon) icon.style.zIndex = ++zTop;
    e.preventDefault(); // no text selection / native image drag
  }, true);

  container.addEventListener('pointermove', e => {
    if(!drag || e.pointerId !== drag.pointerId) return;
    const mx = e.clientX - drag.x0, my = e.clientY - drag.y0;
    if(drag.resizing){
      // Width only: the image keeps its aspect ratio, so height follows.
      drag.c.w = Math.max(MIN_W, Math.min(MAX_W, Math.round(drag.w0 + mx)));
      drag.el.style.width = drag.c.w + 'px';
    } else {
      drag.c.dx = Math.round(drag.dx0 + mx);
      drag.c.dy = Math.round(drag.dy0 + my);
      drag.el.style.left = (CENTER + drag.c.dx) + 'px';
      drag.el.style.top  = (CENTER + drag.c.dy) + 'px';
    }
    updateLeader(drag.el);
  }, true);

  function endDrag(e){
    if(!drag || e.pointerId !== drag.pointerId) return;
    try { drag.el.releasePointerCapture(e.pointerId); } catch(err) {}
    drag = null;
    App.storage.autosave(); // layout lives on the point, so just persist it
  }
  container.addEventListener('pointerup', endDrag, true);
  container.addEventListener('pointercancel', endDrag, true);

  App.photoCards = { html, isShown, toggle, schedule, refresh: updateAll };
})();
