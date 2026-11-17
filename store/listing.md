# Chrome Web Store listing

Copy for the developer dashboard. Fields are in the order the dashboard asks for them.

## Store listing

**Name**

heyo

**Summary** (132 characters at most)

Miss a button by a few pixels and heyo clicks it for you. It starts in a log-only mode that changes nothing on any page.

**Description**

When you miss a button by a few pixels, nothing happens, even though anyone watching would know what you meant. heyo fixes that. If a click lands on empty space and one nearby button or link is clearly the one you aimed for, heyo sends the click there.

heyo is careful about when it steps in:

- A click that already hit something is never touched.
- If the page reacted to your click, heyo leaves it alone. Closing a menu or clicking away from a text field works as before.
- If two controls are close together, heyo does not guess.
- It never clicks something that looks like it cannot be undone, such as Delete, Pay or Send.

heyo starts in shadow mode. For the first two weeks it only keeps a log on your device of the near misses it sees and what it would have done. It changes nothing on any page.

The review page, behind the toolbar button, shows each of those would-be clicks as a small drawing. You mark each one right or wrong with a key press. heyo unlocks retargeting only when your own marks show it would have been wrong less than 1% of the time, and right often enough to be worth having. Until then the switch stays locked.

Privacy:

- Nothing leaves your device. heyo has no server and makes no network calls.
- It never stores the contents of the fields you type in, and never what a password field holds. It reads the page's text fields only to blank what you typed out of the button names it keeps. The privacy policy lists the two cases where typed text can still appear in a name.
- You can export the log to a file or delete it at any time.

heyo is open source: https://github.com/krishhgg/heyo

**Category**

Accessibility

**Language**

English

## Graphics

- Store icon: `src/extension/icons/icon-128.png`
- Screenshots, 1280 by 800: `store/screenshots/1-review.png`, `2-numbers.png`, `3-retargeting.png`
- Small promo tile, 440 by 280: `store/promo-440x280.png`

`npm run store:shots` regenerates the screenshots and the tile from the built extension.

## Privacy practices

**Single purpose**

heyo sends a mouse click that landed on empty space to the nearby control the user aimed for.

**Permission justification: storage**

heyo stores its settings there, such as whether retargeting is on and when the user reported a wrong click, so that the scripts running in pages can read them.

**Permission justification: host permissions (content scripts on all sites)**

A missed click can happen on any page. The content script listens for the user's own clicks. When one lands on empty space it looks at the clickable elements within 30 px of it and at the element under the pointer. To keep typed text out of the log, it also reads the page's text fields at that moment, and at the user's next click if that lands on a control, in memory, and blanks what they hold out of the names it records. It reads the selected text and the page's address before and after a click to tell whether they changed, and stores only the hostname. While the pointer moves, and around a click, the browser tells it of each change to the page, old attribute values included, and it keeps only the fact and counts. With retargeting on, it notes whether a key was pressed between a click and the moment it sends the click on, never which key.

**Remote code**

No. All code ships in the package.

**Data usage**

heyo does not transmit any user data. Everything below stays in the extension's storage on the user's device until the user deletes it or exports it to a file.

- Website content: the short visible names of clickable elements near a click, and the text directly in the element under the pointer, 40 characters at most each. Also the kind of each element, its size and position, whether it was disabled, how many click handlers were under the pointer, and whether and how much the page changed around the click.
- Web history: the hostname of the page a logged click was on. No paths.
- User activity: a daily count of clicks per site, and for a logged click its position, the pointer path over the 300 ms before it, how long the button was held, where the next click went and what it hit, and whether the window had focus.

heyo does not sell data, does not use it for anything unrelated to its single purpose, and does not use it for creditworthiness or lending.

**Privacy policy URL**

https://github.com/krishhgg/heyo/blob/main/docs/privacy.md

## Distribution

- Visibility: start with Unlisted, so the listing can be checked before it is public.
- The package is `dist/heyo-extension-<version>.zip`, built by `npm run package`.

## Notes for the reviewer

heyo runs on all sites because a missed click can happen anywhere, which is why it asks for broad host access.

To see it work: open any page, click a few pixels beside a button, then click the toolbar button. The Review tab shows that click as a drawing. Retargeting is off and locked in a fresh install, so no page is changed.
