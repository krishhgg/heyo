// A deliberately simple decision for the loop's tests and its verification
// drive. Scripted agents edit a copy of this file, so those tests do not
// depend on what the shipped decision looks like.
import type { ClickFeatures, Decision, RefuseReason } from '../core/types';

const MAX_DIST = 12;

function refuse(reason: RefuseReason): Decision {
  return { action: 'refuse', reason };
}

export function decide(features: ClickFeatures): Decision {
  if (features.reacted) return refuse('reacted');
  const byDist = [...features.candidates].sort((a, b) => a.dist - b.dist);
  const nearest = byDist[0];
  if (!nearest) return refuse('no-candidate');
  if (nearest.dist > MAX_DIST) return refuse('too-far');
  if (nearest.kind === 'opaque') return refuse('ambiguous');
  const runnerUp = byDist[1];
  if (runnerUp && runnerUp.dist < 2 * nearest.dist) return refuse('ambiguous');
  if (nearest.disabled) return refuse('disabled');
  return { action: 'retarget', candidate: nearest.id };
}
