# heyo privacy policy

Last updated 17 November 2026.

heyo is a Chrome extension that forgives near-miss clicks. This page says what it records, where that stays, and what it never touches.

## The short version

heyo keeps a log of some of your clicks on your own device. It sends nothing anywhere. It has no server, no account and no analytics, and its code contains no network calls. You can export the log to a file or delete it at any time.

## What heyo records

For every plain left click, heyo counts it under the site's hostname and the day.

When a click lands on empty space near something clickable, heyo also records:

- the hostname of the site, and the time
- where in the window the click landed, and the window's size
- the size and position of the clickable things within 30 px, their type, and a short name for each, at most 40 characters, such as the text on a button
- the path of the mouse pointer over the 300 milliseconds before the click
- how long the button was held and whether the pointer moved
- whether the page reacted to the click
- where your next click went, if it came within 1.5 seconds
- which of those things heyo would have clicked for you, and, once you turn retargeting on, whether it did

On the review page you can mark heyo's choices right or wrong. Those marks are stored with the log.

## What heyo never records

- Anything you type. heyo does not read the value of a form field, and it skips text inside editable areas.
- Passwords. A password field is only ever recorded as the words "password field".
- Page addresses beyond the hostname. No paths, no query strings.
- Page content other than the short names of clickable things near a click.

Pages sometimes repeat what you typed in a button or a link, such as "Search for ...". heyo compares each name with what the page's text fields hold at that moment and blanks any part that matches. One case is not covered: text you wrote earlier that a page now shows as its own content, such as the subject of a message you sent, can appear as the name of a link.

## Where it is stored

In Chrome's storage for the extension, on your device. It is not synced. It stays there until you delete it from the review page or remove the extension.

## What leaves your device

Nothing, unless you choose "Export the log" on the review page. That saves a file to your computer. What you do with the file is up to you. It holds the hostnames and the short names described above.

## Permissions

- Running on all sites. heyo has to see a click on whatever page you are on. It reads the page only around a click, as described above.
- Storage. heyo keeps its settings there: whether retargeting is on, whether it waits out a double-click, and the times at which you reported a wrong click.

## Changes to pages

In shadow mode, which is how heyo starts, it changes nothing on any page. If you turn retargeting on, heyo clicks the control you aimed for when you miss it, on a short list of sites, and nothing else.

## Contact

Questions and requests go to the issue tracker at https://github.com/krishhgg/heyo/issues.
