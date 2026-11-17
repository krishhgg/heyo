// The hand review. One would-be fire at a time, marked right, wrong or not sure.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Verdict } from '../../../core/types';
import { kindOf, nameOf, plural, reviewKey, type Fire } from './data';
import { Plate } from './Plate';

/**
 * How long the verdict stamp shows before the next click comes up. Keys are
 * ignored for that long, so a double tap cannot mark a click nobody has seen.
 */
const STAMP_MS = 240;

/**
 * How long the next click is on screen before it can be marked. A second tap
 * that comes a little late would otherwise land on a click nobody has looked at.
 */
const LOOK_MS = 300;

const VERDICT_WORDS: Record<Verdict, string> = {
  right: 'Right',
  wrong: 'Wrong',
  unsure: 'Not sure',
};

interface Props {
  /** False while another section is showing. Keys do nothing then. */
  active: boolean;
  /** Every would-be fire, in review order. */
  fires: Fire[];
  verdicts: Map<string, Verdict>;
  onVerdict: (fire: Fire, verdict: Verdict) => Promise<void>;
}

function firstUnreviewed(fires: Fire[], done: (key: string) => boolean, after = -1): string | null {
  const later = fires.slice(after + 1).find((f) => !done(reviewKey(f)));
  const any = later ?? fires.find((f) => !done(reviewKey(f)));
  return any ? reviewKey(any) : null;
}

function when(epoch: number): string {
  return new Date(epoch).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Where in the browser window the click landed. */
function ViewportMap({ fire }: { fire: Fire }) {
  const { point, viewport } = fire.record.features;
  const width = 56;
  const height = Math.max(10, Math.round((width * viewport.h) / Math.max(viewport.w, 1)));
  return (
    <svg
      class="viewport-map"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <rect x="0.5" y="0.5" width={width - 1} height={height - 1} rx="2" />
      {/* Kept inside the outline, so a click at the window's edge still shows whole. */}
      <circle
        cx={Math.min(width - 3.5, Math.max(3.5, (width * point.x) / Math.max(viewport.w, 1)))}
        cy={Math.min(height - 3.5, Math.max(3.5, (height * point.y) / Math.max(viewport.h, 1)))}
        r="2.4"
      />
    </svg>
  );
}

export function ReviewView({ active, fires, verdicts, onVerdict }: Props) {
  const done = (key: string) => verdicts.has(key);
  const [at, setAt] = useState<string | null>(() => firstUnreviewed(fires, done));
  const [trail, setTrail] = useState<string[]>([]);
  const [stamp, setStamp] = useState<Verdict | null>(null);
  /** True from a mark until the next click has been on screen long enough to be marked. */
  const [settling, setSettling] = useState(false);
  /** True after a mark could not be stored. The click stays up to be marked again. */
  const [unsaved, setUnsaved] = useState(false);
  const busy = useRef(false);
  const frame = useRef<HTMLDivElement>(null);
  /** What the click on screen was marked before the mark being stamped now. */
  const before = useRef<Verdict | undefined>(undefined);

  const index = fires.findIndex((f) => reviewKey(f) === at);
  const fire = index >= 0 ? fires[index] : undefined;
  // The way back holds only clicks that are still in the log. A deleted log takes its marks with it.
  const live = trail.filter((k) => k !== at && fires.some((f) => reviewKey(f) === k));

  // New fires can arrive while the page is open, and the one on screen can be
  // deleted. Pick one up whenever there is nothing on screen.
  useEffect(() => {
    if (!fire && !busy.current) setAt(firstUnreviewed(fires, done));
  }, [fires, verdicts, at]);

  // In a small window the reviewer scrolls down to the buttons. The next drawing
  // has to come back into view, or it would be marked unseen.
  useEffect(() => {
    frame.current?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const mark = (verdict: Verdict) => {
    if (!active || !fire || busy.current) return;
    busy.current = true;
    setSettling(true);
    const release = () => {
      busy.current = false;
      setSettling(false);
    };
    const key = reviewKey(fire);
    before.current = verdicts.get(key);
    setUnsaved(false);
    setStamp(verdict);
    // The wait is the guard against a double tap, so it stays when motion is reduced.
    const shown = new Promise((resolve) => window.setTimeout(resolve, STAMP_MS));
    void Promise.all([onVerdict(fire, verdict), shown]).then(
      () => {
        setTrail((t) => [...t.filter((k) => k !== key), key]);
        setAt(firstUnreviewed(fires, (k) => k === key || done(k), index));
        setStamp(null);
        // The next click has to be looked at before it can be marked.
        window.setTimeout(release, LOOK_MS);
      },
      () => {
        // The mark was not stored, so the click stays where it is.
        setUnsaved(true);
        setStamp(null);
        release();
      },
    );
  };

  const back = () => {
    if (!active || busy.current) return;
    const previous = live.at(-1);
    if (!previous) return;
    setTrail(live.filter((k) => k !== previous));
    setAt(previous);
  };

  // The key listener is added once and reads the latest handlers through a ref,
  // so a key pressed right after a render never runs a stale handler.
  const actions = useRef({ mark, back });
  actions.current = { mark, back };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === 'y') actions.current.mark('right');
      else if (key === 'n') actions.current.mark('wrong');
      else if (key === 'u') actions.current.mark('unsure');
      else if (key === 'z') actions.current.back();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const marked = fires.filter((f) => verdicts.has(reviewKey(f))).length;

  // Only how far along the pile is. What the marks add up to, and how many the
  // gate needs, are on the numbers page, where they cannot lean on the next mark.
  const progress = (
    <div class="progress">
      <div
        class="progress-bar"
        role="img"
        aria-label={`${marked} of ${plural(fires.length, 'would-be fire')} marked`}
      >
        <span style={{ width: `${fires.length === 0 ? 0 : (100 * marked) / fires.length}%` }} />
      </div>
      <p class="progress-text">
        <strong class="num">{marked}</strong> marked
        <span class="sep"> · </span>
        <span class="num">{fires.length - marked}</span> waiting
      </p>
    </div>
  );

  if (!fire) {
    return (
      <section class="review">
        <div class="empty">
          {fires.length === 0 ? (
            <>
              <h2>Nothing to review yet</h2>
              <p>
                heyo logs a would-be fire when you click empty space right beside a button or a link
                and the page does nothing. Keep browsing, then come back.
              </p>
            </>
          ) : (
            <>
              <h2>All caught up</h2>
              <p>
                You have marked every would-be fire heyo has logged so far. New ones show up here as
                you browse.
              </p>
              {live.length > 0 && (
                <button class="ghost" onClick={back}>
                  Back to the last one <kbd>Z</kbd>
                </button>
              )}
            </>
          )}
        </div>
        {progress}
      </section>
    );
  }

  const { record, picked } = fire;
  const others = record.features.candidates.filter((c) => c.id !== picked.id);
  // While a mark is being stamped the screen still shows the click as it was
  // before, so nothing moves and a fresh mark does not look like an earlier one.
  const earlier = stamp ? before.current : verdicts.get(reviewKey(fire));
  // A held Enter on a focused answer would mark every click that comes up.
  const noRepeat = (event: KeyboardEvent) => {
    if (event.repeat) event.preventDefault();
  };

  return (
    <section class="review">
      <div class="bench">
        <div class="drawing">
          <div class="plate-frame" ref={frame}>
            <Plate fire={fire} />
            {stamp && <div class={`stamp stamp-${stamp}`}>{VERDICT_WORDS[stamp]}</div>}
          </div>
          <ul class="legend" aria-label="What the drawing shows">
            <li class="legend-click">your click</li>
            <li class="legend-pick">heyo's pick</li>
            <li class="legend-near">other controls</li>
            <li class="legend-opaque">an iframe, video or canvas</li>
            <li class="legend-path">the pointer's path</li>
          </ul>
        </div>

        <div class="call">
          {/* The name keeps room for two lines, so the buttons sit in the same place for every click. */}
          <div class="pick">
            <p class="eyebrow">heyo would have sent this click to</p>
            <h2 class="target" title={nameOf(picked)}>
              {nameOf(picked)}
            </h2>
            <p class="target-kind">
              {kindOf(picked)}
              <span class="sep"> · </span>
              <span class="num">{picked.dist}</span> px from where you clicked
            </p>
          </div>

          <p class="question">Is that what you were aiming for?</p>
          <div class="verdicts" aria-busy={settling}>
            <button
              class={earlier === 'right' ? 'verdict right chosen' : 'verdict right'}
              onClick={() => mark('right')}
              onKeyDown={noRepeat}
            >
              Yes, right <kbd>Y</kbd>
            </button>
            <button
              class={earlier === 'wrong' ? 'verdict wrong chosen' : 'verdict wrong'}
              onClick={() => mark('wrong')}
              onKeyDown={noRepeat}
            >
              No, wrong <kbd>N</kbd>
            </button>
            <button
              class={earlier === 'unsure' ? 'verdict unsure chosen' : 'verdict unsure'}
              onClick={() => mark('unsure')}
              onKeyDown={noRepeat}
            >
              Not sure <kbd>U</kbd>
            </button>
          </div>
          {unsaved && (
            <p class="unsaved" role="alert">
              That mark was not saved. Mark this click again.
            </p>
          )}
          {earlier && (
            <p class="earlier">
              You marked this <strong>{VERDICT_WORDS[earlier].toLowerCase()}</strong>. Mark it again
              to change it or to move on.
            </p>
          )}
          <button class="ghost" onClick={back} disabled={live.length === 0}>
            Back to the last one <kbd>Z</kbd>
          </button>

          <dl class="facts">
            <dt>Also nearby</dt>
            <dd>
              {others.length === 0
                ? 'Nothing else within 30 px'
                : others.map((c) => `${nameOf(c)} (${c.dist} px)`).join(', ')}
            </dd>
            <dt>You clicked on</dt>
            <dd>
              blank space inside <code>{`<${record.features.under.tag}>`}</code>
            </dd>
            <dt>Where</dt>
            <dd class="where">
              <ViewportMap fire={fire} />
              <span>
                {record.site}
                <br />
                {when(record.t)}
              </span>
            </dd>
          </dl>
        </div>
      </div>
      {progress}
    </section>
  );
}
