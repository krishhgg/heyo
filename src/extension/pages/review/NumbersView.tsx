// The numbers the plan steers by, with the gate each one has to clear.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  GATES,
  missRateGate,
  recoveryGate,
  wrongTargetGate,
  type GateStatus,
} from '../../../core/gates';
import { addDays, dayOf } from '../../../core/days';
import { missRate, type Score } from '../../../core/metrics';
import type { Log } from '../../db';
import { trialsNeeded } from '../../../core/stats';
import { beside, failsSoFar, percentBeside, plural } from './data';

interface Props {
  log: Log;
  score: Score;
  onExport: () => Promise<void>;
  onDelete: () => Promise<void>;
}

/** How long the delete button ignores clicks after it appears, so a double-click cannot reach it. */
const ARM_MS = 600;

const STATUS_WORDS: Record<GateStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  inconclusive: 'Not enough data yet',
};

/** `soFar` marks a fail that more review marks can still turn around. */
function Status({ status, soFar }: { status: GateStatus; soFar?: boolean }) {
  const words = status === 'fail' && soFar ? 'Fail so far' : STATUS_WORDS[status];
  return <span class={`status status-${status}`}>{words}</span>;
}

function percent(value: number | null, digits = 1): string {
  return value === null ? 'none yet' : `${(100 * value).toFixed(digits)}%`;
}

/** One measure. `needs` is the limit it has to meet. `note` says why a measure has none. */
function Row(props: {
  name: string;
  value: string;
  needs?: string;
  note?: string;
  status?: GateStatus;
  soFar?: boolean;
}) {
  return (
    <tr>
      <th scope="row">{props.name}</th>
      <td class="num">{props.value}</td>
      {props.note ? <td class="note">{props.note}</td> : <td>{props.needs}</td>}
      <td>{props.status && <Status status={props.status} soFar={props.soFar} />}</td>
    </tr>
  );
}

/**
 * One tick per calendar day of shadow mode, counted from the first logged day.
 * A tall tick is a day heyo saw clicks. A short dark tick is a day that passed with none.
 */
function DayRuler({ log, elapsed }: { log: Log; elapsed: number }) {
  const active = new Set(log.counts.filter((c) => c.clicks > 0).map((c) => c.day));
  const first = [...active].sort()[0];
  return (
    <div
      class="ruler"
      role="img"
      aria-label={
        elapsed <= GATES.shadowDays
          ? `Day ${elapsed} of ${GATES.shadowDays}`
          : `Day ${elapsed}, past the ${GATES.shadowDays} that shadow mode runs for`
      }
    >
      {Array.from({ length: GATES.shadowDays }, (_, i) => {
        const on = first !== undefined && active.has(addDays(first, i));
        return <span key={i} class={on ? 'tick on' : i < elapsed ? 'tick past' : 'tick'} />;
      })}
    </div>
  );
}

export function NumbersView({ log, score, onExport, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [armed, setArmed] = useState(false);
  /** What could not be done to the log, when the store refused. */
  const [failed, setFailed] = useState<'exported' | 'deleted' | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);

  // The button just clicked is gone, so focus moves to the safe choice. The
  // delete button takes clicks only after a moment.
  useEffect(() => {
    if (!confirming) return;
    keep.current?.focus();
    setArmed(false);
    const timer = window.setTimeout(() => setArmed(true), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const close = () => {
    setConfirming(false);
    // Wait for the first button to be back before giving it the focus.
    window.setTimeout(() => remove.current?.focus(), 0);
  };
  const rate = missRate(log.records, log.counts, dayOf(Date.now()));
  const rateGate = missRateGate(rate);
  const recovery = recoveryGate(score);
  const wrong = wrongTargetGate(score);
  const doubleShare = score.fires > 0 ? score.doublePress / score.fires : null;
  // With few marks the bound can sit over the limit and still come down as marks come in.
  const sample = trialsNeeded(0, GATES.maxWrongRate);
  const wrongSoFar = failsSoFar(wrong.status, wrong.reviewed, sample);

  return (
    <section class="numbers">
      <article class="sheet">
        <header>
          <h2>Do clicks miss often enough to matter?</h2>
          <Status status={rateGate.status} />
        </header>
        <p class="sheet-note">
          A miss is a click on empty space that the page ignored, followed within 1.5 seconds by a
          click on a control within 30 px. Shadow mode runs for {GATES.shadowDays} days before this
          is judged. A page that changes on its own makes every click look answered, so a retry
          there cannot be called a miss and is listed apart.
        </p>
        <DayRuler log={log} elapsed={rate.elapsedDays} />
        <p class="ruler-caption">
          {rate.elapsedDays === 0 ? (
            'No clicks logged yet'
          ) : (
            <>
              Day <span class="num">{rate.elapsedDays}</span>
              {rate.elapsedDays <= GATES.shadowDays
                ? ` of ${GATES.shadowDays}`
                : `, past the ${GATES.shadowDays} that shadow mode runs for`}
              . Clicks on <span class="num">{rate.activeDays}</span> of them.
            </>
          )}
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">So far</th>
              <th scope="col">Needs</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            <Row name="Clicks seen" value={rate.clicks.toLocaleString()} />
            <Row name="Misses" value={rate.misses.toLocaleString()} />
            <Row
              name="Misses as a share of clicks"
              value={percentBeside(rate.rate, GATES.minMissRate)}
              needs={`${100 * GATES.minMissRate}% or more`}
            />
            <Row
              name="Misses a day"
              value={
                rate.perDay === null ? 'none yet' : beside(rate.perDay, GATES.minMissesPerDay, 1)
              }
              needs={`${GATES.minMissesPerDay} or more`}
            />
            <Row
              name="Retries on a page that was already changing"
              value={rate.masked.toLocaleString()}
              note="not counted"
            />
          </tbody>
        </table>
      </article>

      <article class="sheet">
        <header>
          <h2>Would heyo pick the right target?</h2>
          <Status
            status={
              recovery.status === 'pass' && wrong.status === 'pass'
                ? 'pass'
                : recovery.status === 'fail' || wrong.status === 'fail'
                  ? 'fail'
                  : 'inconclusive'
            }
            soFar={wrongSoFar && recovery.status !== 'fail'}
          />
        </header>
        <p class="sheet-note">
          Recovery is how often heyo picked the control you went on to click after a miss. The
          wrong-target rate comes from your own review marks, and its upper bound has to sit under{' '}
          {100 * GATES.maxWrongRate}%.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">So far</th>
              <th scope="col">Needs</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            <Row
              name="Recovery"
              value={
                recovery.recovery === null
                  ? 'none yet'
                  : `${percentBeside(recovery.recovery, GATES.minRecovery, 0)} (${score.recovered} of ${score.misses})`
              }
              needs={`${100 * GATES.minRecovery}% or more, on ${GATES.minMisses} misses or more`}
              status={recovery.status}
            />
            <Row name="Would-be fires" value={score.fires.toLocaleString()} />
            <Row
              name="Fires you reviewed"
              value={`${wrong.reviewed} (${wrong.wrong} wrong)`}
              needs={`${wrong.needed} with ${wrong.wrong === 0 ? 'none' : wrong.wrong} wrong`}
            />
            <Row
              name="Fires you marked not sure"
              value={score.unsure.toLocaleString()}
              note="left out of the rate"
            />
            <Row
              name="Wrong-target rate, upper bound"
              value={percentBeside(wrong.upper, GATES.maxWrongRate)}
              needs={`under ${100 * GATES.maxWrongRate}%`}
              status={wrong.status}
              soFar={wrongSoFar}
            />
            <Row
              name="Fires followed by a second press"
              value={
                doubleShare === null
                  ? 'none yet'
                  : `${percent(doubleShare, 1)} (${score.doublePress})`
              }
            />
          </tbody>
        </table>
      </article>

      <article class="sheet">
        <header>
          <h2>Your log</h2>
        </header>
        <p class="sheet-note">
          The log stays in this browser until you export it. An export holds the sites you clicked
          on and the visible names of nearby controls. heyo looks at what is typed in a page's
          fields only to blank the names that repeat it, and stores none of it. A name can still
          hold something personal, such as the subject of a message shown as a link, so read an
          export before you share it.
        </p>
        <p class="log-size">
          {plural(log.records.length, 'logged click')} and{' '}
          {plural(log.reviews.length, 'review mark')}
        </p>
        <div class="log-actions">
          <button
            class="primary"
            onClick={() => {
              setFailed(null);
              void onExport().catch(() => setFailed('exported'));
            }}
          >
            Export the log
          </button>
          {confirming ? (
            <>
              {/* The safe choice sits where the first click landed, so a double-click keeps the log. */}
              <button class="ghost" ref={keep} onClick={close}>
                Keep the log
              </button>
              <button
                class="danger"
                aria-disabled={!armed}
                onClick={() => {
                  if (!armed) return;
                  setFailed(null);
                  void onDelete().then(close, () => setFailed('deleted'));
                }}
              >
                Delete {plural(log.records.length, 'click')} and all marks
              </button>
            </>
          ) : (
            <button class="ghost" ref={remove} onClick={() => setConfirming(true)}>
              Delete the log
            </button>
          )}
        </div>
        {failed && (
          <p class="unsaved" role="alert">
            The log could not be {failed}. Nothing was changed. Try again.
          </p>
        )}
        {confirming && (
          <p class="sheet-note">
            Deleting also clears the click counts, so the {GATES.shadowDays} days of shadow mode
            start again.
          </p>
        )}
      </article>
    </section>
  );
}
