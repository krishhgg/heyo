# heyo privacy policy

Last updated 17 November 2026.

heyo is a Chrome extension that forgives near-miss clicks. This page says what it records, where that stays, and what it never touches.

## The short version

heyo keeps a log of some of your clicks on your own device. It sends nothing anywhere. It has no server, no account and no analytics, and its code contains no network calls. You can export the log to a file or delete it at any time.

## What heyo records

For every plain left click, heyo adds one to a count for the site's hostname and the day. There are four counts: all clicks, clicks that hit something, clicks on empty space the page reacted to, and clicks on empty space the page ignored.

When a click lands on empty space near something clickable, heyo also stores a record of that click. A record holds:

- a random id, the hostname of the site, and the time
- where in the window the click landed, the window's size, and the display scale, which is the screen's pixel density times the page zoom
- whether the click was in the page itself or in an embedded frame, and whether the window had focus
- for each clickable thing within 30 px: its size and position, how far it was, its kind (the tag, the role, the type of an input, and the signs heyo took it for clickable by), whether it was disabled, a short name, at most 40 characters, such as the text on a button, and whether part of that name was blanked
- what was under the pointer: the kind of element, and at most 40 characters of the text directly in it
- the path of the mouse pointer over the 300 milliseconds before the click
- how long the button was held and how far the pointer moved while it was down
- how the page reacted: whether its content, focus, selection, scroll position or address changed, how many changes to its content there were and how many of those were at the click or at a nearby clickable thing, whether focus moved the way the browser moves it by itself, whether focus left a text field, and whether the page was already changing just before the click. Only the fact of a change and these counts are kept, never what changed
- how many click handlers the page had on the elements under the pointer
- your next click, if it came within 1.5 seconds: how soon, how far from the first, what kind of thing it hit (a control, text, empty space or an embedded region), whether that was one of the clickable things in the record, and how far that control was from the first click
- which of those things heyo would have clicked for you and why not if it would not have, and, once you turn retargeting on, what it did
- the version of heyo and of its decision rule

On the review page you can mark heyo's choices right or wrong. Those marks are stored with the log, each with its time.

## What heyo reads and does not keep

- **What your text fields hold.** heyo reads the text fields on the page, password fields among them, the text of editable areas, and the names of files you have chosen in a file field. It does this when you click on empty space, again at your next click if that one lands on a control, and, with retargeting on, at the moment it sends a click on. The one purpose is to blank the same text out of the names it is about to record or compare. What it read is dropped at once. It is never stored and never leaves the page.
- **The selected text**, before and after a click, to tell whether the click changed the selection.
- **The page's full address**, before and after a click, to tell whether the click changed it. Only the hostname is ever stored.
- **Changes to the page.** While the pointer moves, and from a press until a moment after the click, the browser tells heyo of each change to the page's content. For a changed attribute that includes its old value, which heyo compares with the new one to set aside writes that changed nothing and markers that only follow focus. heyo keeps the fact and the counts, not what changed.
- **Whether a key was pressed**, only with retargeting on, and only between a click and the moment heyo sends it on, so that it sends nothing once you have moved on. It never looks at which key.

## What heyo never records

- The contents of a form field or of an editable area. They are never stored as such.
- Passwords. A password field is only ever recorded as the words "password field".
- Page addresses beyond the hostname. No paths, no query strings.
- Page content other than the short names of clickable things near a click and the short text under the pointer.

## Where typed text can still end up in the log

Pages sometimes repeat what you typed in a button or a link, such as "Search for ...". heyo compares each name, and the text under the pointer, with what the page's text fields hold at that moment. It blanks any run of six or more characters a name shares with what you typed. When what you typed is three words or fewer, it also blanks each of those words of three or more characters. Three cases are not covered:

- Text of one or two characters. heyo does not match text that short, so if you type "Al" into a field and the page shows a button named "Al", that name is recorded.
- A short word out of a longer text. With "Alice has a new message" in a field, a button named "Alice" is recorded, because the name is under six characters and the text is over three words.
- Text you wrote earlier that a page now shows as its own content. The subject of a message you sent can appear as the name of a link.

If a page has more than 300 text fields, or a field holds more than 20,000 characters, heyo cannot check them all, and it blanks every name whole.

## Where it is stored

In Chrome's storage for the extension, on your device. It is not synced. It stays there until you delete it from the review page or remove the extension.

## What leaves your device

Nothing, unless you choose "Export the log" on the review page. That saves a file to your computer. What you do with the file is up to you. It holds everything listed under "What heyo records", the hostnames and the short names among it.

## Permissions

- Running on all sites. heyo has to see a click on whatever page you are on. What it reads from a page, and when, is listed above.
- Storage. heyo keeps its settings there: whether retargeting is on, whether it waits out a double-click, which clicks in the log you reported as wrong and when, and the version of its decision rule that your log last passed with.

## Changes to pages

In shadow mode, which is how heyo starts, it changes nothing you can see on any page and sends the page no events. To know which elements have click handlers, it wraps the page's function for adding event listeners. The wrapper notes which elements get a click listener and passes every call through unchanged.

If you turn retargeting on, heyo clicks the control you aimed for when you miss it, on a short list of sites, and nothing else.

## Contact

Questions and requests go to the issue tracker at https://github.com/krishhgg/heyo/issues.
