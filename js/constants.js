/* =============================================================================
   constants.js
   Static configuration shared across the app: the icon + label for each
   fixation-point "source type" (shown in the point modal and on markers),
   and the quick-pick tag suggestions shown when creating a route.
   To add a new source type or tag suggestion, only this file needs to change.
   ============================================================================= */
const App = window.App || (window.App = {});

App.constants = {
  SOURCE_TYPES: {
    camera:  { label: 'Відеокамера',     icon: '📹' },
    dashcam: { label: 'Відеореєстратор', icon: '🎥' },
    other:   { label: 'Інше',            icon: '📍' }
  },

  COMMON_TAGS: ["Свідок", "Кур'єр", "Об'єкт спостереження", "Водій", "Перехожий"]
};
