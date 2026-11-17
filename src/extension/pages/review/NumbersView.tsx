// The numbers the plan steers by, with the gate each one has to clear.
import { useState } from 'preact/hooks';
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
import { percentBeside } from './data';

interface Props {
  log: Log;
  score: Score;
  onExport: () => void;
  onDelete: () => Promise<void>;
}

const STATUS_WORDS: Record<GateStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  inconclusive: 'Not enough data yet',
};

function Status({ status }: { status: GateStatus }) {
  return <span class={`status status-${status}`}>{STATUS_WORDS[status]}</span>;
}

function percent(value: number | null, digits = 1): string {
  return value === null ? 'none yet' : `${(100 * value).toFixed(digits)}%`;
}

function Row(props: { name: string; value: string; needs: string; status?: GateStatus }) {
  return (
    <tr>
      <th scope="row">{props.name}</th>
      <td class="num">{props.value}</td>
      <td>{props.needs}</td>
      <td>{props.status && <Status status={props.status} />}</td>
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
    <div class="ruler" role="img" aria-label={`Day ${elapsed} of ${GATES.shadowDays}`}>
      {Array.from({ length: GATES.shadowDays }, (_, i) => {
        const on = first !== undefined && active.has(addDays(first, i));
        return <span key={i} class={on ? 'tick on' : i < elapsed ? 'tick past' : 'tick'} />;
      })}
    </div>
  );
}

export function NumbersView({ log, score, onExport, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const rate = missRate(log.records, log.counts, dayOf(Date.now()));
  const rateGate = missRateGate(rate);
  const recovery = recoveryGate(score);
  const wrong = wrongTargetGate(score);
  const doubleShare = score.fires > 0 ? score.doublePress / score.fires : null;

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
            <Row name="Clicks seen" value={rate.clicks.toLocaleString()} needs="" />
            <Row name="Misses" value={rate.misses.toLocaleString()} needs="" />
            <Row
              name="Misses as a share of clicks"
              value={percent(rate.rate, 2)}
              needs={`${100 * GATES.minMissRate}% or more`}
            />
            <Row
              name="Misses a day"
              value={rate.perDay === null ? 'none yet' : rate.perDay.toFixed(1)}
              needs={`${GATES.minMissesPerDay} or more`}
            />
            <Row
              name="Retries on a page that was already changing"
              value={rate.masked.toLocaleString()}
              needs="not counted"
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
                  : `${percent(recovery.recovery, 0)} (${score.recovered} of ${score.misses})`
              }
              needs={`${100 * GATES.minRecovery}% or more, on ${GATES.minMisses} misses or more`}
              status={recovery.status}
            />
            <Row name="Would-be fires" value={score.fires.toLocaleString()} needs="" />
            <Row
              name="Fires you reviewed"
              value={`${wrong.reviewed} (${wrong.wrong} wrong)`}
              needs={`${wrong.needed} with this many wrong`}
            />
            <Row
              name="Wrong-target rate, upper bound"
              value={percentBeside(wrong.upper, GATES.maxWrongRate)}
              needs={`under ${100 * GATES.maxWrongRate}%`}
              status={wrong.status}
            />
            <Row
              name="Fires followed by a second press"
              value={
                doubleShare === null
                  ? 'none yet'
                  : `${percent(doubleShare, 0)} (${score.doublePress})`
              }
              needs=""
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
          on and the visible names of nearby controls. heyo never reads what is in a form field, and
          it blanks any name that repeats what a field holds.
        </p>
        <p class="log-size">
          <span class="num">{log.records.length.toLocaleString()}</span> logged clicks,{' '}
          <span class="num">{log.reviews.length.toLocaleString()}</span> review marks
        </p>
        <div class="log-actions">
          <button class="primary" onClick={onExport}>
            Export the log
          </button>
          {confirming ? (
            <>
              <button
                class="danger"
                onClick={() => {
                  void onDelete().then(() => setConfirming(false));
                }}
              >
                Delete {log.records.length.toLocaleString()} clicks and all marks
              </button>
              <button class="ghost" onClick={() => setConfirming(false)}>
                Keep the log
              </button>
            </>
          ) : (
            <button class="ghost" onClick={() => setConfirming(true)}>
              Delete the log
            </button>
          )}
        </div>
      </article>
    </section>
  );
}
