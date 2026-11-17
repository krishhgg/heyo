// Turning retargeting on and off, and reporting a click it got wrong.
import { GATES, retargetGates, type GateStatus } from '../../../core/gates';
import { wasSent } from '../../../core/labels';
import type { Score } from '../../../core/metrics';
import type { ClickRecord } from '../../../core/types';
import type { Log } from '../../db';
import type { PageRequest } from '../../messages';
import { sitesOf, type Settings } from '../../settings';
import { percentBeside, verdictsOf } from './data';

interface Props {
  log: Log;
  score: Score;
  settings: Settings;
  /** Sends a request to the service worker, which is the only place settings change. */
  request: (request: PageRequest) => Promise<void>;
}

/** A site's share of clicks that changed nothing is judged only from this many sent clicks. */
const ENOUGH_SENT = 20;

/** How many of the latest sent clicks are listed. */
const RECENT = 12;

const STATUS_WORDS: Record<GateStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  inconclusive: 'Not enough data yet',
};

const OFF_REASONS: Record<NonNullable<Settings['offReason']>, string> = {
  gates:
    'heyo turned retargeting off because your log no longer passes both gates. It can go on again once they pass.',
  error:
    'heyo turned retargeting off because it could not read or write its log. It can go on again once the gates pass.',
  'wrong-clicks':
    'heyo turned retargeting off because of wrong clicks you reported. Review more fires, then turn it on again if the gates pass.',
  irreversible: 'heyo turned retargeting off after a wrong click that could not be undone.',
};

function percent(value: number | null, digits = 0): string {
  return value === null ? 'none yet' : `${(100 * value).toFixed(digits)}%`;
}

function when(epoch: number): string {
  return new Date(epoch).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The name of the control a sent click went to. */
function targetOf(record: ClickRecord): string {
  const picked = record.decision.action === 'retarget' ? record.decision.candidate : -1;
  return record.features.candidates[picked]?.label || 'an unnamed control';
}

export function RetargetView({ log, score, settings, request }: Props) {
  const gates = retargetGates(score);
  const on = settings.mode === 'retarget';
  // A report of a click that could not be undone is worth its warning also
  // when it was made while retargeting was off.
  const undone = settings.wrongReports.some((report) => report.irreversible);
  const warnings: string[] = [];
  // That the log stopped passing is worth saying only while it does not pass.
  const stale = settings.offReason === 'gates' && gates.pass;
  if (settings.offReason && !stale) warnings.push(OFF_REASONS[settings.offReason]);
  if (undone && settings.offReason !== 'irreversible') {
    warnings.push('You reported a wrong click that could not be undone.');
  }
  // Advice about the switch only when the switch can be used.
  if ((undone || settings.offReason === 'irreversible') && gates.pass) {
    warnings.push('Think twice before turning it on again.');
  }
  const sites = sitesOf(settings);
  // The latest mark counts, as in the gate. A mark changed to right on the Review tab is not wrong.
  const verdicts = verdictsOf(log.reviews);
  const isWrong = (record: ClickRecord) =>
    record.decision.action === 'retarget' &&
    verdicts.get(`${record.id}:${record.decision.candidate}`) === 'wrong';
  const sent = log.records.filter(wasSent);
  const recent = [...sent].sort((a, b) => b.t - a.t).slice(0, RECENT);
  const held = log.records.filter((r) => r.fire?.outcome === 'held').length;
  const ignoredShare = score.sent > 0 ? score.sentIgnored / score.sent : null;
  const bySite = new Map<string, { sent: number; ignored: number }>();
  for (const record of sent) {
    const site = bySite.get(record.site) ?? { sent: 0, ignored: 0 };
    site.sent++;
    if (!record.fire?.reacted) site.ignored++;
    bySite.set(record.site, site);
  }
  const doubleShare = score.fires > 0 ? score.doublePress / score.fires : null;

  return (
    <section class="numbers">
      <article class="sheet">
        <header>
          <h2>{on ? 'Retargeting is on' : 'Retargeting is off'}</h2>
          {on ? (
            <button
              class="ghost switch"
              onClick={() => void request({ type: 'setMode', mode: 'shadow' })}
            >
              Turn retargeting off
            </button>
          ) : (
            <button
              class="primary switch"
              disabled={!gates.pass}
              onClick={() => void request({ type: 'setMode', mode: 'retarget' })}
            >
              Turn retargeting on
            </button>
          )}
        </header>
        <p class="sheet-note">
          {on
            ? 'When a click lands on empty space on one of the sites below, the page ignores it, and one nearby control is clearly the one you aimed for, heyo clicks that control. One fire in ten is held back so your own retries keep measuring it.'
            : gates.pass
              ? 'Both gates pass on your log. Turning this on lets heyo click the control you aimed for, on the sites below only.'
              : 'Retargeting stays locked until both gates pass on your own log. Keep browsing in shadow mode and mark the would-be fires on the Review tab.'}
        </p>
        {!on && warnings.length > 0 && <p class="warning">{warnings.join(' ')}</p>}
        <table>
          <thead>
            <tr>
              <th scope="col">Gate</th>
              <th scope="col">So far</th>
              <th scope="col">Needs</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Recovery</th>
              <td class="num">
                {gates.recovery.recovery === null
                  ? 'no misses yet'
                  : `${percentBeside(gates.recovery.recovery, GATES.minRecovery, 0)} of ${gates.recovery.misses} misses`}
              </td>
              <td>
                {100 * GATES.minRecovery}% or more, on {GATES.minMisses} misses or more. A miss held
                back as a control counts as {1 / GATES.heldShare}.
              </td>
              <td>
                <span class={`status status-${gates.recovery.status}`}>
                  {STATUS_WORDS[gates.recovery.status]}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row">Wrong-target rate</th>
              <td class="num">
                {gates.wrongTarget.reviewed === 0
                  ? 'none reviewed yet'
                  : `${gates.wrongTarget.wrong} wrong in ${gates.wrongTarget.reviewed} reviewed`}
              </td>
              <td>
                upper bound under {100 * GATES.maxWrongRate}%, which takes{' '}
                {gates.wrongTarget.needed} reviewed
              </td>
              <td>
                <span class={`status status-${gates.wrongTarget.status}`}>
                  {STATUS_WORDS[gates.wrongTarget.status]}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <h3>Sites where heyo may act</h3>
        {sites.length === 0 ? (
          <p class="sheet-note">
            No site is on the list yet. A site is added in the code once a scripted near miss on it
            makes the intended action happen exactly once.
          </p>
        ) : (
          <ul class="sites">
            {sites.map((site) => (
              <li key={site} class="num">
                {site}
              </li>
            ))}
          </ul>
        )}
      </article>

      <article class="sheet">
        <header>
          <h2>Clicks heyo sent on</h2>
        </header>
        <p class="sheet-note">
          If one of these was not what you meant, say so here. A report is a wrong mark in the gate
          above, so one report turns retargeting off if the gate then fails. It also turns off after
          a second report in a week, or after one that could not be undone.
        </p>
        <table>
          <tbody>
            <tr>
              <th scope="row">Sent on</th>
              <td class="num">{score.sent.toLocaleString()}</td>
              <td />
            </tr>
            <tr>
              <th scope="row">Changed nothing heyo could see</th>
              <td class="num">
                {score.sentIgnored.toLocaleString()}
                {/* A no-break space keeps the count and its share on one line. */}
                {ignoredShare !== null && `\u00a0(${percent(ignoredShare)})`}
              </td>
              <td>
                runs high, since a click that worked without changing the page counts too. A site
                over {100 * GATES.maxIgnoredShare}% whose clicks did nothing comes off the list in
                the code
              </td>
            </tr>
            <tr>
              <th scope="row">Held back as a control</th>
              <td class="num">{held.toLocaleString()}</td>
              <td />
            </tr>
          </tbody>
        </table>
        {bySite.size > 0 && (
          <ul class="shares" aria-label="Clicks that changed nothing, by site">
            {[...bySite].map(([site, n]) => (
              <li key={site}>
                <span class="num">{site}</span>
                <span>
                  {n.ignored.toLocaleString()} of {n.sent.toLocaleString()} changed nothing (
                  {percent(n.ignored / n.sent)})
                </span>
                {n.sent >= ENOUGH_SENT && n.ignored / n.sent > GATES.maxIgnoredShare && (
                  <span class="status status-fail">over {100 * GATES.maxIgnoredShare}%</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {recent.length > 0 && (
          <ul class="fires">
            {recent.map((record) => (
              <li key={record.id}>
                <span class="fire-what">
                  <strong>{targetOf(record)}</strong>
                  <span class="fire-where">
                    {record.site}, {when(record.t)}
                    {record.fire?.reacted === false && ', changed nothing heyo could see'}
                  </span>
                </span>
                {isWrong(record) ? (
                  <span class="fire-actions">
                    <span class="status status-fail">Marked wrong</span>
                    {/* A slip on either button can be taken back here, report and all. */}
                    <button
                      class="ghost"
                      onClick={() =>
                        record.decision.action === 'retarget' &&
                        void request({
                          type: 'review',
                          review: {
                            recordId: record.id,
                            candidate: record.decision.candidate,
                            verdict: 'right',
                            t: Date.now(),
                          },
                        })
                      }
                    >
                      Not wrong
                    </button>
                  </span>
                ) : (
                  <span class="fire-actions">
                    <button
                      class="ghost"
                      onClick={() =>
                        void request({
                          type: 'reportWrong',
                          recordId: record.id,
                          irreversible: false,
                        })
                      }
                    >
                      Wrong
                    </button>
                    <button
                      class="ghost"
                      onClick={() =>
                        void request({
                          type: 'reportWrong',
                          recordId: record.id,
                          irreversible: true,
                        })
                      }
                    >
                      Wrong, and it could not be undone
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </article>

      <article class="sheet">
        <header>
          <h2>Double-clicks</h2>
        </header>
        <p class="sheet-note">
          heyo cannot tell the first click of a double-click from a single click.{' '}
          {doubleShare === null ? (
            'There are no would-be fires yet to measure this on.'
          ) : (
            <>
              So far <span class="num">{percent(doubleShare)}</span> of would-be fires were followed
              by a second press in the same spot within half a second.
            </>
          )}{' '}
          If that happens often, have heyo wait.
        </p>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.waitForDoubleClick}
            onChange={(event) =>
              void request({ type: 'setWaitForDoubleClick', value: event.currentTarget.checked })
            }
          />
          Wait half a second before sending a click on, and send nothing if a second press comes
          first
        </label>
      </article>
    </section>
  );
}
