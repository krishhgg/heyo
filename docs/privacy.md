# heyo privacy policy

Last updated 17 November 2026.

heyo is a Chrome extension that forgives near-miss clicks. This page says what it records, where that stays, and what it never touches.

## The short version

heyo keeps a log of some of your clicks on your own device. It sends nothing anywhere. It has no server, no account and no analytics, and its code contains no network calls. You can export the log to a file or delete it at any time.

## What heyo records

For every plain left click, heyo counts it under the site's hostname and the day.

When a click lands on empty space near something clickable, heyo also records:

- the hostname of the site, and the time
- where in the window the click landed, the window's size and its zoom
- whether the click was in the page itself or in an embedded frame, and whether the window had focus
- the clickable things within 30 px: their size and position, their kind (the tag, the role, the type of an input, and why heyo took them for clickable), whether they were disabled, and a short name for each, at most 40 characters, such as the text on a button
- what was under the pointer: the kind of element, and at most 40 characters of the text directly in it
- the path of the mouse pointer over the 300 milliseconds before the click
- how long the button was held and how far the pointer moved while it was down
- how the page reacted: whether its content, focus, selection, scroll position or address changed, how many changes there were, and whether the page was already changing just before the click. Only the fact of a change is kept, never what changed
- how many click handlers the page had on the elements under the pointer
- where your next click went, if it came within 1.5 seconds: how far from the first, how soon, and whether it hit one of those clickable things
- which of those things heyo would have clicked for you, and, once you turn retargeting on, what it did
- the version of heyo and of its decision rule

On the review page you can mark heyo's choices right or wrong. Those marks are stored with the log.

## What heyo reads and does not keep

- **What your text fields hold.** At a click on empty space, heyo reads the text fields on the page, password fields among them, and the names of files you have chosen in a file field. It does this for one purpose: to blank the same text out of the names it is about to record. What it read is dropped at once. It is never stored and never leaves the page.
- **The selected text**, before and after a click, to tell whether the click changed the selection.
- **Whether the page is changing.** While the pointer moves, and from a press until a moment after the click, the browser tells heyo when the page changes. heyo keeps the fact and a count, not what changed.
- **Whether a key was pressed**, only with retargeting on, and only between a click and the moment heyo sends it on, so that it sends nothing once you have moved on. It never looks at which key.

## What heyo never records

- Anything you type. The value of a form field and the text of an editable area are never recorded.
- Passwords. A password field is only ever recorded as the words "password field".
- Page addresses beyond the hostname. No paths, no query strings.
- Page content other than the short names of clickable things near a click and the short text under the pointer.

Pages sometimes repeat what you typed in a button or a link, such as "Search for ...". heyo compares each name, and the text under the pointer, with what the page's text fields hold at that moment and blanks any part that matches. One case is not covered: text you wrote earlier that a page now shows as its own content, such as the subject of a message you sent, can appear as the name of a link.

## Where it is stored

In Chrome's storage for the extension, on your device. It is not synced. It stays there until you delete it from the review page or remove the extension.

## What leaves your device

Nothing, unless you choose "Export the log" on the review page. That saves a file to your computer. What you do with the file is up to you. It holds everything listed under "What heyo records", the hostnames and the short names among it.

## Permissions

- Running on all sites. heyo has to see a click on whatever page you are on. What it reads from a page, and when, is listed above.
- Storage. heyo keeps its settings there: whether retargeting is on, whether it waits out a double-click, which clicks in the log you reported as wrong and when, and the version of its decision rule that your log last passed with.

## Changes to pages

In shadow mode, which is how heyo starts, it changes nothing on any page. If you turn retargeting on, heyo clicks the control you aimed for when you miss it, on a short list of sites, and nothing else.

## Contact

Questions and requests go to the issue tracker at https://github.com/krishhgg/heyo/issues.
