/* Minimal Leaflet stand-in for functional tests (no network available).
   Real DOM is created for markers so photo-card pointer logic is exercised in Chromium. */
(function(){
  const BASE = {lat:49.55, lng:25.59}, SCALE = 100000;
  const toLL = a => Array.isArray(a) ? {lat:a[0], lng:a[1]} : {lat:a.lat, lng:a.lng};
  const project = ll => ({x: 400 + (ll.lng-BASE.lng)*SCALE, y: 300 - (ll.lat-BASE.lat)*SCALE});

  function Evented(){}
  Evented.prototype.on = function(types, fn){ this._ev = this._ev || {}; types.split(/\s+/).forEach(t => (this._ev[t] = this._ev[t] || []).push(fn)); return this; };
  Evented.prototype.fire = function(t, data){ ((this._ev||{})[t]||[]).slice().forEach(fn => fn.call(this, Object.assign({type:t, target:this}, data))); return this; };
  const inherit = (C) => { C.prototype = Object.create(Evented.prototype); C.prototype.constructor = C; };

  function Map(id){ this._container = document.getElementById(id); this._container.style.position='relative';
    this._pane = document.createElement('div'); this._pane.className='leaflet-marker-pane';
    this._pane.style.cssText='position:absolute;left:0;top:0;width:0;height:0;'; this._container.appendChild(this._pane); }
  inherit(Map);
  Map.prototype.setView = function(){ return this; };
  Map.prototype.getContainer = function(){ return this._container; };
  Map.prototype.latLngToLayerPoint = function(ll){ return project(toLL(ll)); };
  Map.prototype.layerPointToLatLng = function(p){ return { lat: BASE.lat - (p.y - 300) / SCALE, lng: BASE.lng + (p.x - 400) / SCALE }; };
  Map.prototype.addLayer = function(l){ l._addToMap(this); return this; };
  Map.prototype.removeLayer = function(l){ l._removeFromMap(this); return this; };
  Map.prototype.closePopup = function(){ if(this._popupEl){ this._popupEl.remove(); this._popupEl = null; } };
  Map.prototype.invalidateSize = function(){}; Map.prototype.fitBounds = function(){};

  function Marker(ll, opts){ this._latlng = toLL(ll); this.options = opts || {}; }
  inherit(Marker);
  Marker.prototype.addTo = function(t){ t.addLayer(this); return this; };
  Marker.prototype._addToMap = function(map){
    if(this._map) return; this._map = map;
    const ic = this.options.icon, p = project(this._latlng), el = document.createElement('div');
    el.className = 'leaflet-marker-icon leaflet-interactive ' + (ic.className || '');
    el.style.cssText = `position:absolute;left:${p.x - ic.iconAnchor[0]}px;top:${p.y - ic.iconAnchor[1]}px;width:${ic.iconSize[0]}px;height:${ic.iconSize[1]}px;`;
    el.innerHTML = ic.html; map._pane.appendChild(el); this._icon = el;
    el.__marker = this;
    el.addEventListener('click', () => { this.fire('click'); if(this._popupHtml) this.openPopup(); });
    this.fire('add');
  };
  Marker.prototype._removeFromMap = function(){ if(this._icon) this._icon.remove(); this._icon = null; this._map = null; this.fire('remove'); };
  Marker.prototype.getElement = function(){ return this._icon; };
  Marker.prototype.bindPopup = function(h){ this._popupHtml = h; return this; };
  Marker.prototype.bindTooltip = function(h, o){ this._tip = h; this._tipOpts = o; return this; };
  Marker.prototype.openPopup = function(){ const map = this._map; map.closePopup();
    const el = document.createElement('div'); el.className = 'leaflet-popup'; el.innerHTML = this._popupHtml;
    map._container.appendChild(el); map._popupEl = el; map.fire('popupopen', {popup:{getElement: () => el}}); };
  Marker.prototype.getLatLng = function(){ return this._latlng; };
  Marker.prototype.setLatLng = function(ll){ this._latlng = toLL(ll); return this; };
  Marker.prototype.setZIndexOffset = function(){ return this; };

  function LayerGroup(){ this._layers = []; }
  inherit(LayerGroup);
  LayerGroup.prototype.addLayer = function(l){ this._layers.push(l); if(this._map) l._addToMap(this._map); return this; };
  LayerGroup.prototype.clearLayers = function(){ this._layers.forEach(l => l._removeFromMap(this._map)); this._layers = []; };
  LayerGroup.prototype.addTo = function(t){ t.addLayer(this); return this; };
  LayerGroup.prototype._addToMap = function(m){ this._map = m; this._layers.forEach(l => l._addToMap(m)); };
  LayerGroup.prototype._removeFromMap = function(){ this._layers.forEach(l => l._removeFromMap(this._map)); this._map = null; };

  function Polyline(lls, o){ this._lls = lls.map(toLL); this.options = o || {}; }
  inherit(Polyline);
  Polyline.prototype._addToMap = function(m){ this._map = m; (window.__lines = window.__lines || []).push(this); };
  Polyline.prototype._removeFromMap = function(){ const a = window.__lines || [], i = a.indexOf(this); if(i >= 0) a.splice(i, 1); this._map = null; };

  function Noop(){}
  inherit(Noop); Noop.prototype._addToMap = function(){}; Noop.prototype._removeFromMap = function(){};

  function MCG(){ this._markers = []; }
  inherit(MCG);
  MCG.prototype._addToMap = function(m){ this._map = m; this._markers.forEach(x => x._addToMap(m)); };
  MCG.prototype._removeFromMap = function(){ this._markers.forEach(x => x._removeFromMap()); this._map = null; };
  MCG.prototype.addLayers = function(a){ a.forEach(x => { this._markers.push(x); if(this._map) x._addToMap(this._map); }); };
  MCG.prototype.removeLayers = function(a){ a.forEach(x => { const i = this._markers.indexOf(x); if(i >= 0) this._markers.splice(i, 1); x._removeFromMap(); }); };

  window.L = {
    map: id => (window.__map = new Map(id)),
    tileLayer: () => ({ addTo(){ return this; } }),
    marker: (ll, o) => new Marker(ll, o),
    divIcon: o => o,
    layerGroup: () => new LayerGroup(),
    polyline: (l, o) => new Polyline(l, o),
    polylineDecorator: () => new Noop(),
    markerClusterGroup: () => new MCG(),
    Symbol: { arrowHead: () => ({}) },
    latLngBounds: () => ({ pad(){ return this; } }),
    point: (x, y) => ({ x, y }),
    DomEvent: { stopPropagation(e){ if(e.originalEvent) e.originalEvent._stopped = true; } }
  };
})();
