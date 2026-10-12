/* =============================================================================
   history.js
   Undo / Redo (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z, plus the ↶ ↷ buttons in the
   sidebar header). Works for everything that edits the data — points, bends,
   routes, tags, colours, photos & photo cards, POI markers, bulk/JSON import,
   loading a plan — without each of those having to know about it:
     - storage.js calls commit() on every "something changed" signal (the same
       one that triggers the browser autosave);
     - commit() compares the data with the last known state and, if it
       differs, remembers the previous state as one undo step;
     - changes arriving in quick succession (dragging a colour picker, say)
       are merged into a single step (see config.burstMs).
   What is NOT part of history: which routes are shown/hidden and which are
   expanded in the list (view state, kept as-is when undoing), and the history
   itself is not saved — it starts empty on every page load.
   ============================================================================= */
//const App = window.App || (window.App = {});

App.history = {};

(function(){
  const { state, utils } = App;

  const config = { limit: 100, burstMs: 500 };

  // Photos are big base64 strings; copying them into every snapshot would eat
  // memory. Snapshots keep a short reference instead, and the real string is
  // stored once here.
  const photoIds = new Map();
  const photos = [];
  function replacer(key, value){
    if(key === 'photo' && typeof value === 'string' && value.startsWith('data:')){
      let id = photoIds.get(value);
      if(id === undefined){ id = photos.length; photos.push(value); photoIds.set(value, id); }
      return '@@photo:' + id;
    }
    return value;
  }
  function reviver(key, value){
    return (key === 'photo' && typeof value === 'string' && value.startsWith('@@photo:')) ? photos[+value.slice(8)] : value;
  }

  // The undoable part of the state, as a string (cheap to compare, immutable).
  function serialize(){
    return JSON.stringify({
      routes: state.routes.map(({ _expanded, visible, ...r }) => r),
      markers: state.markers
    }, replacer);
  }

  let undoStack = [], redoStack = [];
  let current = null;      // serialized state as of the last commit (null until reset() after the first load)
  let burstOpen = false, burstTimer = null;
  let applying = false;    // true while an undo/redo is being applied (so it isn't recorded as a change)

  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  function updateButtons(){
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
  }

  // Forget all history and take the current data as the starting point —
  // called once the initial data has been loaded (main.js).
  function reset(){
    undoStack = []; redoStack = [];
    burstOpen = false; clearTimeout(burstTimer);
    current = serialize();
    updateButtons();
  }

  // Called after every change (via App.storage.autosave()).
  function commit(){
    if(applying || current === null) return;
    const now = serialize();
    if(now === current) return;                       // nothing but view state changed
    if(!burstOpen){                                    // first change of a burst => new undo step
      undoStack.push(current);
      if(undoStack.length > config.limit) undoStack.shift();
      redoStack = [];
      burstOpen = true;
    }
    current = now;
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => { burstOpen = false; }, config.burstMs);
    updateButtons();
  }

  function apply(snapshot){
    applying = true;
    try{
      const data = JSON.parse(snapshot, reviver);
      // Keep the current show/hide + expanded state of routes that still exist.
      const keep = new Map(state.routes.map(r => [r.id, { visible: r.visible, _expanded: r._expanded }]));
      state.routes = utils.normalizeRoutes(data.routes).map(r => Object.assign(r, keep.get(r.id) || {}));
      state.markers = utils.normalizeMarkers(data.markers);
      App.map.instance.closePopup();
      App.pointModal.stopMode();
      App.poi.cancelPlacing();
      App.map.renderAll();       // also removes the layers of routes that no longer exist
      App.poi.renderAll();
      App.sidebar.render();
    } finally {
      applying = false;
    }
    current = serialize();       // re-measured: normalising may reorder keys, and must not look like a new change
    burstOpen = false; clearTimeout(burstTimer);
    updateButtons();
    App.storage.autosave();      // persist the restored data (sees no difference => no new undo step)
  }

  function undo(){
    if(!undoStack.length) return;
    redoStack.push(current);
    apply(undoStack.pop());
  }
  function redo(){
    if(!redoStack.length) return;
    undoStack.push(current);
    apply(redoStack.pop());
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // Keyboard: matched by physical key (e.code), so it also works on a Ukrainian
  // layout. Left alone while typing in a field (the browser's own text undo
  // applies there) and while a dialog is open.
  document.addEventListener('keydown', e => {
    if(!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if([...document.querySelectorAll('.overlay')].some(o => o.style.display === 'flex')) return;
    if(e.code === 'KeyZ' && !e.shiftKey){ e.preventDefault(); undo(); }
    else if(e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)){ e.preventDefault(); redo(); }
  });

  App.history = { commit, reset, undo, redo, config, depth: () => ({ undo: undoStack.length, redo: redoStack.length }) };
})();
