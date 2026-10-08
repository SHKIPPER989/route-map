/* =============================================================================
   constants.js
   Static configuration shared across the app:
     - SOURCE_TYPES      icon + label for each fixation-point "source" (the
                         video camera / dashcam / other dropdown in the point modal)
     - COMMON_TAGS       quick-pick tag suggestions when creating a route
     - MARKER_ICON_TYPES icon + label for standalone map markers (poi.js) —
                         Будинок, Авто, Підозрюваний, Небезпечний об'єкт, etc.
   Only this one file declares `const App` — every other file just assigns to
   App.xxx. Classic <script> tags share one global scope, so redeclaring
   `const App` in more than one file is a SyntaxError (this bit us once already).
   To add a new source type, tag suggestion, or marker icon, only this file
   needs to change — nothing else references these values by name.
   ============================================================================= */
const App = window.App || (window.App = {});

App.constants = {
  SOURCE_TYPES: {
    camera:  { label: 'Відеокамера',     icon: '📹' },
    dashcam: { label: 'Відеореєстратор', icon: '🎥' },
    other:   { label: 'Інше',            icon: '📍' }
  },

  COMMON_TAGS: ["Свідок", "Кур'єр", "Об'єкт спостереження", "Водій", "Перехожий"],

  // Standalone map markers (not tied to a route/timeline) — placed, edited
  // and rendered by poi.js.
  MARKER_ICON_TYPES: {
    home:    { label: 'Будинок',              icon: '🏠' },
    car:     { label: 'Автомобіль',           icon: '🚘' },
    suspect: { label: 'Підозрювана особа',    icon: '🥷' },
    hazard:  { label: "Небезпечний об'єкт",   icon: '💣' },
    camera:  { label: 'Камера спостереження', icon: '📷' },
    flag:    { label: 'Позначка',             icon: '📍' },
    other:   { label: 'Інше',                 icon: '⭐' }
  }
};
