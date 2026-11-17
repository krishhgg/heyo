// The decision. A pure function from the logged features of one empty-space
// click to a target or a refusal. The agent loop edits this module and nothing else.
import { distanceToRect } from '../core/geometry';
import {
  LABEL_MAX,
  SEARCH_RADIUS_PX,
  type Candidate,
  type ClickFeatures,
  type Decision,
  type PathSample,
  type RefuseReason,
} from '../core/types';

/** The runner-up must be at least this many times as far as the nearest control. */
const MARGIN = 4;

/**
 * The nearest control must be within this many px. Farther than that, a rival
 * close enough to break the margin could sit past what the log holds, so the
 * margin could not be checked.
 */
const MAX_DIST = SEARCH_RADIUS_PX / MARGIN;

/** The runner-up must also be at least this many px farther than the nearest control. */
const MIN_GAP = 8;

/** Floor for the margin test, so two controls a hair apart stay ambiguous. */
const MIN_DIST = 1;

/** A press that moved more than this many px is a drag. */
const DRAG_PX = 4;

/** A press held longer than this many ms is a long press. */
const LONG_PRESS_MS = 500;

/** The cursor moved away when it ended this many px farther from the control than it started. */
const AWAY_PX = 2;

/** A miss comes at the end of a movement. The cursor must have been this many px from the click point in the logged path. */
const MIN_REACH = 2;

/** Labels that suggest a click the user cannot take back. */
const IRREVERSIBLE = [
  'delete',
  'remove',
  'erase',
  'discard',
  'destroy',
  'trash',
  'wipe',
  'clear',
  'reset',
  'revoke',
  'deactivate',
  'uninstall',
  'overwrite',
  'pay',
  'buy',
  'purchase',
  'order',
  'checkout',
  'donate',
  'transfer',
  'withdraw',
  'bid',
  'sell',
  'book',
  'reserve',
  'subscribe',
  'unsubscribe',
  'subscription',
  'subscribed',
  'booking',
  'reservation',
  'payment',
  'close account',
  'upgrade',
  'send',
  'submit',
  'post',
  'publish',
  'tweet',
  'retweet',
  'repost',
  'invite',
  'like',
  'follow',
  'following',
  'unfollow',
  'vote',
  'upvote',
  'downvote',
  'block',
  'report',
  'ban',
  'leave',
  'sign out',
  'log out',
  'logout',
  'confirm',
  'approve',
  'reject',
  'decline',
  'accept',
  'agree',
  'merge',
  'deploy',
];

const IRREVERSIBLE_PATTERN = new RegExp(`\\b(${IRREVERSIBLE.join('|')})\\b`, 'i');

function refuse(reason: RefuseReason): Decision {
  return { action: 'refuse', reason };
}

/**
 * A label that cannot be read whole cannot be checked, so it counts as
 * irreversible: one with a blanked part, or one long enough to have been cut,
 * where the word that matters may be past the cut.
 */
function looksIrreversible(candidate: Candidate): boolean {
  return (
    candidate.redacted ||
    candidate.label.length >= LABEL_MAX ||
    IRREVERSIBLE_PATTERN.test(candidate.label)
  );
}

function inside(sample: PathSample, candidate: Candidate): boolean {
  return distanceToRect(sample, candidate.rect) === 0;
}

/**
 * True when the cursor path argues against the control. That is when the cursor
 * started nearer the control than it ended, unless it came from elsewhere and
 * passed over the control on the way, which is an overshoot.
 */
function movedAway(path: PathSample[], candidate: Candidate): boolean {
  const first = path[0];
  if (!first) return false;
  const startDist = distanceToRect(first, candidate.rect);
  if (startDist + AWAY_PX >= candidate.dist) return false;
  const overshot = startDist > 0 && path.some((sample) => inside(sample, candidate));
  return !overshot;
}

/**
 * The farthest the cursor was from the click point over the logged path, in
 * px. Distance covered would not do: a hand at rest jitters a pixel back and
 * forth, and that adds up.
 */
function reach(path: PathSample[]): number {
  let far = 0;
  for (const sample of path) far = Math.max(far, Math.hypot(sample.x, sample.y));
  return far;
}

export function decide(features: ClickFeatures): Decision {
  if (features.reacted) return refuse('reacted');
  // The page was changing just before the press. What is nearest now may have
  // moved under the cursor, and not be what the user aimed at.
  if (features.churn === true) return refuse('churn');
  if (!features.focused) return refuse('unfocused');
  if (features.press.move > DRAG_PX) return refuse('drag');
  if (features.press.ms > LONG_PRESS_MS) return refuse('long-press');

  const byDist = [...features.candidates].sort((a, b) => a.dist - b.dist);
  const nearest = byDist[0];
  if (!nearest) return refuse('no-candidate');
  if (nearest.dist > MAX_DIST) return refuse('too-far');
  // An opaque region competes for the click but can never be the target.
  if (nearest.kind === 'opaque') return refuse('ambiguous');
  const runnerUp = byDist[1];
  if (
    runnerUp &&
    (runnerUp.dist < MARGIN * Math.max(nearest.dist, MIN_DIST) ||
      runnerUp.dist - nearest.dist < MIN_GAP)
  ) {
    return refuse('ambiguous');
  }
  if (nearest.disabled) return refuse('disabled');
  // A control with no name cannot be checked for what it does, and a reviewer cannot judge it.
  if (nearest.label === '') return refuse('unlabeled');
  if (looksIrreversible(nearest)) return refuse('irreversible');
  // A click from a cursor at rest is not the end of an aimed movement.
  if (reach(features.path) < MIN_REACH) return refuse('rest');
  if (movedAway(features.path, nearest)) return refuse('path');

  return { action: 'retarget', candidate: nearest.id };
}
