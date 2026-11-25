// The practice page. One control at a time is lit, and the person clicks it.
// The page logs every press on the stage and which control was lit at the
// time, and hands its log to the practice run through a function the run adds
// to the page. It never changes the page in answer to a press that misses, so
// heyo sees a miss here as it sees one on a page that ignores it.
'use strict';

const params = new URLSearchParams(location.search);
const TRIALS = Math.max(1, Math.min(2000, Math.round(Number(params.get('trials')) || 240)));

/** Hits on one scene before the next one comes up. */
const PER_SCENE = 24;

/** About how long one hit takes, for the estimate on the start screen. */
const SECONDS_PER_HIT = 2;

/**
 * heyo refuses a click when the DOM changed in the 300 ms before it. A new
 * scene is the page's only DOM change, so it waits this long before lighting
 * a control.
 */
const SETTLE_MS = 400;

const stage = document.getElementById('stage');
const promptLine = document.getElementById('prompt');
const finishButton = document.getElementById('finish');

// The lit control and the count are set through the style sheet. That leaves
// the DOM as it was, so a hit is not a page change to heyo.
const [cueRule, countRule] = document.getElementById('cue').sheet.cssRules;
const UNLIT = '.c[data-n="none"]';

/** Added by the practice run. A page opened on its own has nowhere to save. */
const save = typeof window.heyoPracticeSave === 'function' ? window.heyoPracticeSave : null;

const log = { format: 'heyo-practice', v: 1, trials: TRIALS, hits: 0, done: false, presses: [] };
let lit = null;
let scene = 0;
let running = false;

/** Makes an element. Strings in `children` become text. */
function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else element.setAttribute(key, value);
  }
  element.append(...children);
  return element;
}

const button = (label, props = {}) =>
  el('button', { type: 'button', ...props, class: `c ${props.class ?? ''}`.trim(), text: label });
const icon = (glyph, name, props = {}) =>
  button(glyph, { ...props, class: `icon ${props.class ?? ''}`.trim(), 'aria-label': name });
const link = (text) => el('a', { class: 'c', href: '#', text });
const box = (type, name, props = {}) =>
  el('input', { class: 'c', type, 'aria-label': name, ...props });

/** Text with [[links]] and {n} footnote marks in it. */
function prose(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/\[\[(.+?)\]\]|\{(\d+)\}/g)) {
    parts.push(text.slice(last, match.index));
    parts.push(match[1] ? link(match[1]) : el('sup', {}, link(`[${match[2]}]`)));
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

const MAIL = [
  ['Priya Natarajan', 'Notes from Tuesday', 'I put the action items at the top', 'Nov 23'],
  ['Sam Okafor', 'Draft for the spring issue', 'Here is the second pass, mostly trims', 'Nov 23'],
  ['Lena Fischer', 'Flight times', 'Landing at 6:40, so dinner works', 'Nov 22'],
  ['Diego Ruiz', 'Re: Garden plans', 'The tomatoes go along the south fence', 'Nov 22'],
  ['Mei Tanaka', 'Photos from the hike', 'Forty of them, sorry in advance', 'Nov 21'],
  ['Tom Becker', 'Quarterly numbers', 'Up a little on last year, details inside', 'Nov 20'],
  ['Ana Lima', 'The recipe you asked for', 'Use less salt than it says', 'Nov 19'],
  ['Omar Haddad', 'Room for Thursday', 'The small one on the third floor is free', 'Nov 19'],
  ['Ivy Chen', 'Re: Bike repair', 'The shop says Friday after four', 'Nov 18'],
  ['Noah Weber', 'Reading list', 'Three short ones and one very long one', 'Nov 17'],
];

const FILES = [
  ['budget-2026.xlsx', '84 KB', 'Today'],
  ['site-visit-notes.docx', '22 KB', 'Yesterday'],
  ['floor-plan-v3.pdf', '1.2 MB', 'Nov 19'],
  ['survey-results.csv', '310 KB', 'Nov 14'],
  ['kickoff-slides.key', '6.8 MB', 'Nov 9'],
  ['vendor-contacts.txt', '3 KB', 'Oct 30'],
];

const ARTICLE = [
  'The garden on [[Mill Street]] started as a single raised bed behind the [[library]]. Within two summers it covered the whole lot, with [[forty-one plots]], a shared tool shed and a rota for watering that nobody admits to writing.{1} Most plots grow [[tomatoes]] and [[beans]], and a few grow nothing but [[flowers]].',
  'Membership costs nothing, but each plot holder gives [[two hours]] a month to the shared beds. The [[waiting list]] is long, so the committee now splits large plots when a holder moves away.{2} Seeds come from a [[swap table]] by the gate, which also collects [[jars]], [[string]] and the odd [[bicycle wheel]].{3}',
  'This year the group added a [[rain tank]] and a [[compost bay]], paid for by a [[plant sale]] in May.{4} Next spring it hopes to open a second site near the [[river path]], if the [[council lease]] comes through in time.{5}',
];

const SCENES = [
  {
    name: 'inbox',
    build: () =>
      el(
        'div',
        { class: 'inbox' },
        el(
          'div',
          { class: 'toolbar' },
          icon('⇩', 'Archive'),
          icon('◔', 'Snooze'),
          icon('✉', 'Mark as read'),
          el('span', { class: 'gap' }),
          icon('→', 'Move to'),
          icon('◆', 'Labels'),
          icon('⋯', 'More'),
          el('span', { class: 'spacer' }),
          el('span', { class: 'count', text: '50 of 312' }),
          icon('‹', 'Newer'),
          icon('›', 'Older'),
        ),
        ...MAIL.map(([from, subject, snippet, date], i) =>
          el(
            'div',
            { class: 'mail' },
            box('checkbox', `Select message ${i + 1}`),
            button('☆', { class: 'star', 'aria-label': `Star message ${i + 1}` }),
            el('span', { class: 'from', text: from }),
            el('span', { class: 'subject' }, el('b', { text: subject }), snippet),
            el('span', { class: 'date', text: date }),
            icon('⇩', `Archive message ${i + 1}`, { class: 'act' }),
            icon('◔', `Snooze message ${i + 1}`, { class: 'act' }),
          ),
        ),
      ),
  },
  {
    name: 'project',
    build: () =>
      el(
        'div',
        { class: 'project' },
        el(
          'nav',
          { class: 'crumbs' },
          link('Home'),
          '/',
          link('Projects'),
          '/',
          link('Atlas'),
          '/',
          link('Reports'),
          '/',
          el('span', { text: '2026' }),
        ),
        el('h2', { text: 'Atlas reports' }),
        el(
          'div',
          { class: 'tabs', role: 'tablist' },
          ...['Overview', 'Activity', 'Files', 'Members', 'Insights', 'Settings'].map((name) =>
            button(name, { role: 'tab' }),
          ),
        ),
        el(
          'table',
          { class: 'files' },
          el(
            'tbody',
            {},
            ...FILES.map(([name, size, when]) =>
              el(
                'tr',
                {},
                el('td', {}, link(name)),
                el('td', { class: 'size', text: size }),
                el('td', { class: 'when', text: when }),
                el('td', { class: 'tools' }, button('Open'), button('Rename'), button('Copy link')),
              ),
            ),
          ),
        ),
        el(
          'nav',
          { class: 'pages' },
          button('Previous'),
          ...[1, 2, 3, 4, 5, 6, 7].map((n) => button(String(n), { 'aria-label': `Page ${n}` })),
          el('span', { class: 'dots', text: '…' }),
          button('18', { 'aria-label': 'Page 18' }),
          button('Next'),
        ),
      ),
  },
  {
    name: 'article',
    build: () =>
      el(
        'article',
        { class: 'article' },
        el('h2', { text: 'A garden that grew a street' }),
        el(
          'p',
          { class: 'byline' },
          'By ',
          link('R. Moreau'),
          ' · ',
          link('Local news'),
          ' · 6 min',
        ),
        ...ARTICLE.map((text) => el('p', {}, ...prose(text))),
        el(
          'div',
          { class: 'chips' },
          ...['Gardens', 'Volunteering', 'Food', 'Housing', 'Parks', 'Events', 'Weather'].map(
            (tag) => button(tag),
          ),
        ),
      ),
  },
  {
    name: 'settings',
    build: () => {
      const row = (label, hint, ...controls) =>
        el(
          'div',
          { class: 'setting' },
          el(
            'div',
            { class: 'text' },
            el('div', { class: 'label', text: label }),
            el('div', { class: 'hint', text: hint }),
          ),
          ...controls,
        );
      const toggle = (name, on) =>
        el('button', {
          type: 'button',
          class: 'c switch',
          role: 'switch',
          'aria-label': name,
          'aria-checked': String(on),
        });
      const choices = (name, options, chosen) =>
        el(
          'div',
          { class: 'choices' },
          ...options.flatMap((option) => [
            box('radio', `${name}: ${option}`, {
              name,
              ...(option === chosen ? { checked: '' } : {}),
            }),
            el('span', { text: option }),
          ]),
        );
      const stepper = (name, value) =>
        el(
          'div',
          { class: 'stepper' },
          button('−', { 'aria-label': `Fewer ${name}` }),
          el('output', { text: String(value) }),
          button('+', { 'aria-label': `More ${name}` }),
        );
      return el(
        'div',
        { class: 'settings' },
        row('Dark theme', 'Use dark colors after sunset', toggle('Dark theme', false)),
        row('Compact rows', 'Fit more on each screen', toggle('Compact rows', true)),
        row(
          'Text size',
          'Applies to every page',
          choices('Text size', ['Small', 'Medium', 'Large'], 'Medium'),
        ),
        row('Sounds', 'Play a sound for new messages', toggle('Sounds', true)),
        row('Items per page', 'In lists and search results', stepper('items', 25)),
        row(
          'First day of the week',
          'For calendars and dates',
          choices('First day', ['Sunday', 'Monday', 'Saturday'], 'Monday'),
        ),
        row('Display name', 'Ivy Chen', link('Edit')),
        row('Daily summary', 'Hours after midnight', stepper('hours', 7)),
      );
    },
  },
  {
    name: 'calendar',
    build: () => {
      // November 2026 starts on a Sunday and has 30 days.
      const days = Array.from({ length: 30 }, (_, i) =>
        button(String(i + 1), { 'aria-label': `November ${i + 1}` }),
      );
      const blanks = Array.from({ length: 5 }, () => el('span', { class: 'blank' }));
      const times = [];
      for (let hour = 9; hour < 18; hour++) times.push(`${hour}:00`, `${hour}:30`);
      return el(
        'div',
        { class: 'calendar' },
        el(
          'div',
          { class: 'month' },
          el(
            'div',
            { class: 'head' },
            icon('‹', 'Previous month'),
            el('h2', { text: 'November 2026' }),
            icon('›', 'Next month'),
            button('Today'),
          ),
          el(
            'div',
            { class: 'weekdays' },
            ...'SMTWTFS'.split('').map((d) => el('span', { text: d })),
          ),
          el('div', { class: 'days' }, ...days, ...blanks),
        ),
        el(
          'div',
          { class: 'slots' },
          el('h3', { text: 'Free times on November 24' }),
          el('div', { class: 'grid' }, ...times.map((time) => button(time))),
        ),
      );
    },
  },
];

function rectOf(element) {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function count(text) {
  countRule.style.content = JSON.stringify(text);
}

/** Puts up a scene with nothing lit, and lights a control once the change has settled. */
function show(index) {
  scene = index;
  lit = null;
  cueRule.selectorText = UNLIT;
  const root = SCENES[index].build();
  root.querySelectorAll('.c').forEach((control, n) => (control.dataset.n = String(n)));
  stage.replaceChildren(root);
  setTimeout(light, SETTLE_MS);
}

/** Lights a control at random, never the one just clicked. */
function light() {
  if (!running) return;
  const last = lit;
  const controls = [...stage.querySelectorAll('.c')].filter((control) => control !== last);
  lit = controls[Math.floor(Math.random() * controls.length)];
  cueRule.selectorText = `.c[data-n="${lit.dataset.n}"]`;
}

function next() {
  log.hits++;
  if (log.hits >= TRIALS) {
    finish();
    return;
  }
  count(`${log.hits} of ${TRIALS}`);
  if (log.hits % PER_SCENE === 0) show((scene + 1) % SCENES.length);
  else light();
  save?.(log);
}

function finish() {
  running = false;
  log.done = true;
  stage.hidden = true;
  finishButton.hidden = true;
  promptLine.textContent = '';
  document.getElementById('saving').hidden = false;
  save?.(log);
}

document.getElementById('minutes').textContent = String(
  Math.max(1, Math.round((TRIALS * SECONDS_PER_HIT) / 60)),
);
document.getElementById('unsaved').hidden = save !== null;

document.getElementById('start').addEventListener('click', () => {
  document.getElementById('intro').hidden = true;
  stage.hidden = false;
  finishButton.hidden = false;
  running = true;
  count(`0 of ${TRIALS}`);
  show(0);
});

finishButton.addEventListener('click', finish);

// One listener on the document for every press and click. A listener of the
// page's own on a control is one of the signs heyo knows a control by, and
// the controls here are known by being buttons, links and inputs.
document.addEventListener('pointerdown', (event) => {
  if (!running || !lit || !event.isTrusted || event.button !== 0) return;
  if (!(event.target instanceof Element) || !stage.contains(event.target)) return;
  const control = event.target.closest('.c');
  log.presses.push({
    t: Date.now(),
    x: event.clientX,
    y: event.clientY,
    on: control === lit ? 'target' : control ? 'control' : 'empty',
    target: rectOf(lit),
    scene: SCENES[scene].name,
  });
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  // Links here go nowhere.
  if (event.target.closest('a')) event.preventDefault();
  // A click from the keyboard has no press behind it.
  if (!running || !event.isTrusted || event.detail === 0) return;
  if (lit && event.target.closest('.c') === lit) next();
});
