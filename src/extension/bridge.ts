// Names shared by the content script and the main-world script.
//
// The two scripts live in different JavaScript worlds and can only talk through
// DOM events. The content script picks a random event name for listener queries
// and hands it over with these two fixed events. Both scripts run before any
// page script, so the page never learns the query name and cannot use it to
// detect the extension.

/** The content script sends the query event name in this event's detail. */
export const INIT_EVENT = 'heyo:init';

/** The main-world script announces itself, in case the content script ran first. */
export const READY_EVENT = 'heyo:main-ready';

/** Listener types that mean an element handles clicks. */
export const CLICK_TYPES = [
  'click',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'dblclick',
];
