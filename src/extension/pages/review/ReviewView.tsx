// The hand review. One would-be fire at a time, marked right, wrong or not sure.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Verdict } from '../../../core/types';
import { kindOf, nameOf, reviewKey, type Fire } from './data';
import { Plate } from './Plate';

/**
 * How long the verdict stamp shows before the next click comes up. Keys are
 * ignored for that long, so a double tap cannot mark a click nobody has seen.
 */
const STAMP_MS = 240;

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
  /** Reviewed fires the 1% gate needs, given the wrong targets found so far. */
  needed: number;
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
      <circle cx={(width * point.x) / viewport.w} cy={(height * point.y) / viewport.h} r="2.4" />
    </svg>
  );
}

export function ReviewView({ active, fires, verdicts, needed, onVerdict }: Props) {
  const done = (key: string) => verdicts.has(key);
  const [at, setAt] = useState<string | null>(() => firstUnreviewed(fires, done));
  const [trail, setTrail] = useState<string[]>([]);
  const [stamp, setStamp] = useState<Verdict | null>(null);
  /** True after a mark could not be stored. The click stays up to be marked again. */
  const [unsaved, setUnsaved] = useState(false);
  const busy = useRef(false);
  const frame = useRef<HTMLDivElement>(null);

  const index = fires.findIndex((f) => reviewKey(f) === at);
  const fire = index >= 0 ? fires[index] : undefined;

  // New fires can arrive while the page is open. Pick one up when there is nothing on screen.
  useEffect(() => {
    if (!fire && !busy.current) setAt(firstUnreviewed(fires, done));
  }, [fires, verdicts]);

  // In a small window the reviewer scrolls down to the buttons. The next drawing
  // has to come back into view, or it would be marked unseen.
  useEffect(() => {
    frame.current?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const mark = (verdict: Verdict) => {
    if (!active || !fire || busy.current) return;
    busy.current = true;
    const key = reviewKey(fire);
    setUnsaved(false);
    setStamp(verdict);
    // The wait is the guard against a double tap, so it stays when motion is reduced.
    const shown = new Promise((resolve) => window.setTimeout(resolve, STAMP_MS));
    void Promise.all([onVerdict(fire, verdict), shown])
      .then(
        () => {
          setTrail((t) => [...t.filter((k) => k !== key), key]);
          setAt(firstUnreviewed(fires, (k) => k === key || done(k), index));
        },
        // The mark was not stored, so the click stays where it is.
        () => setUnsaved(true),
      )
      .finally(() => {
        setStamp(null);
        busy.current = false;
      });
  };

  const back = () => {
    if (!active || busy.current) return;
    const previous = trail.filter((k) => k !== at).at(-1);
    if (!previous) return;
    setTrail((t) => t.filter((k) => k !== previous));
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
      else if (key === 'z' || key === 'backspace') actions.current.back();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reviewed = fires.filter((f) => {
    const v = verdicts.get(reviewKey(f));
    return v === 'right' || v === 'wrong';
  }).length;
  const wrong = fires.filter((f) => verdicts.get(reviewKey(f)) === 'wrong').length;
  const unsure = fires.filter((f) => verdicts.get(reviewKey(f)) === 'unsure').length;
  const waiting = fires.length - reviewed - unsure;

  const progress = (
    <div class="progress" aria-label="Review progress">
      <div class="progress-bar" role="img" aria-label={`${reviewed} of ${needed} reviewed`}>
        <span style={{ width: `${Math.min(100, (100 * reviewed) / needed)}%` }} />
      </div>
      <p class="progress-text">
        <strong class="num">{reviewed}</strong> of <span class="num">{needed}</span> reviewed
        <span class="sep"> · </span>
        <span class={wrong > 0 ? 'num bad' : 'num'}>{wrong}</span> wrong
        {unsure > 0 && (
          <>
            <span class="sep"> · </span>
            <span class="num">{unsure}</span> not sure
          </>
        )}
        <span class="sep"> · </span>
        <span class="num">{waiting}</span> waiting
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
              {trail.length > 0 && (
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
  const earlier = verdicts.get(reviewKey(fire));

  return (
    <section class="review">
      <div class="bench">
        <div class="plate-frame" ref={frame}>
          <Plate fire={fire} />
          {stamp && <div class={`stamp stamp-${stamp}`}>{VERDICT_WORDS[stamp]}</div>}
        </div>

        <div class="call">
          <p class="eyebrow">heyo would have sent this click to</p>
          <h2 class="target">{nameOf(picked)}</h2>
          <p class="target-kind">
            a {kindOf(picked)}, <span class="num">{picked.dist}</span> px from where you clicked
          </p>

          <dl class="facts">
            <dt>Also nearby</dt>
            <dd>
              {others.length === 0
                ? 'Nothing else within 30 px'
                : others.map((c) => `${nameOf(c)} (${c.dist} px)`).join(', ')}
            </dd>
            <dt>You clicked on</dt>
            <dd>
              a blank part of a <code>{record.features.under.tag}</code>
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

          <p class="question">Is that what you were aiming for?</p>
          <div class="verdicts">
            <button
              class={earlier === 'right' ? 'verdict right chosen' : 'verdict right'}
              onClick={() => mark('right')}
            >
              Yes, right <kbd>Y</kbd>
            </button>
            <button
              class={earlier === 'wrong' ? 'verdict wrong chosen' : 'verdict wrong'}
              onClick={() => mark('wrong')}
            >
              No, wrong <kbd>N</kbd>
            </button>
            <button
              class={earlier === 'unsure' ? 'verdict unsure chosen' : 'verdict unsure'}
              onClick={() => mark('unsure')}
            >
              Not sure <kbd>U</kbd>
            </button>
          </div>
          {unsaved && (
            <p class="unsaved" role="alert">
              That mark was not saved. Mark this click again.
            </p>
          )}
          <button
            class="ghost"
            onClick={back}
            disabled={trail.filter((k) => k !== at).length === 0}
          >
            Back to the last one <kbd>Z</kbd>
          </button>
        </div>
      </div>
      {progress}
    </section>
  );
}
