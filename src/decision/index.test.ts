import { describe, expect, it } from 'vitest';
import { candidate, features } from '../core/testing';
import { decide } from './index';

const retarget = (id: number) => ({ action: 'retarget', candidate: id });
const refuse = (reason: string) => ({ action: 'refuse', reason });

describe('decide', () => {
  it('picks a lone control within 7.5 px', () => {
    expect(decide(features({ candidates: [candidate(0, 3)] }))).toEqual(retarget(0));
    expect(decide(features({ candidates: [candidate(0, 7.5)] }))).toEqual(retarget(0));
  });

  it('refuses when nothing is nearby', () => {
    expect(decide(features())).toEqual(refuse('no-candidate'));
  });

  it('refuses when the nearest control is over 7.5 px away', () => {
    // The log holds nothing past 30 px. At 8 px a rival would have to be 32 px
    // away to be far enough, and one at 31 px would not be in the log.
    expect(decide(features({ candidates: [candidate(0, 8)] }))).toEqual(refuse('too-far'));
    expect(decide(features({ candidates: [candidate(0, 12)] }))).toEqual(refuse('too-far'));
  });

  it('refuses when the page was changing just before the press', () => {
    const candidates = [candidate(0, 3)];
    expect(decide(features({ candidates, churn: true }))).toEqual(refuse('churn'));
    // Not known is not the same as changing.
    expect(decide(features({ candidates, churn: null }))).toEqual(retarget(0));
  });

  it('refuses when the runner-up is less than four times as far', () => {
    const close = [candidate(0, 4), candidate(1, 15.9)];
    expect(decide(features({ candidates: close }))).toEqual(refuse('ambiguous'));
    const clear = [candidate(0, 4), candidate(1, 16)];
    expect(decide(features({ candidates: clear }))).toEqual(retarget(0));
  });

  it('refuses when the runner-up is less than 8 px farther', () => {
    const close = [candidate(0, 1), candidate(1, 8.9)];
    expect(decide(features({ candidates: close }))).toEqual(refuse('ambiguous'));
    const clear = [candidate(0, 1), candidate(1, 9)];
    expect(decide(features({ candidates: clear }))).toEqual(retarget(0));
  });

  it('picks the nearest control whatever order the candidates come in', () => {
    const candidates = [candidate(0, 11), candidate(1, 2)];
    expect(decide(features({ candidates }))).toEqual(retarget(1));
  });

  it('refuses in a gap between two controls a hair apart', () => {
    const candidates = [candidate(0, 0.4), candidate(1, 1.6)];
    expect(decide(features({ candidates }))).toEqual(refuse('ambiguous'));
  });

  it('refuses when an opaque region is nearest or competes', () => {
    const canvas = candidate(1, 3, { kind: 'opaque', tag: 'canvas' });
    expect(decide(features({ candidates: [canvas, candidate(0, 9)] }))).toEqual(
      refuse('ambiguous'),
    );
    const farCanvas = candidate(1, 6, { kind: 'opaque', tag: 'canvas' });
    expect(decide(features({ candidates: [candidate(0, 4), farCanvas] }))).toEqual(
      refuse('ambiguous'),
    );
  });

  it('refuses when the page reacted, the tab lacked focus, or the press was a drag or long press', () => {
    const candidates = [candidate(0, 3)];
    expect(decide(features({ candidates, reacted: true }))).toEqual(refuse('reacted'));
    expect(decide(features({ candidates, focused: false }))).toEqual(refuse('unfocused'));
    expect(decide(features({ candidates, press: { ms: 80, move: 5 } }))).toEqual(refuse('drag'));
    expect(decide(features({ candidates, press: { ms: 501, move: 0 } }))).toEqual(
      refuse('long-press'),
    );
  });

  it('refuses a control with no name, such as an icon button without a label', () => {
    const candidates = [candidate(0, 3, { label: '' })];
    expect(decide(features({ candidates }))).toEqual(refuse('unlabeled'));
  });

  it('refuses a disabled control', () => {
    const candidates = [candidate(0, 3, { disabled: true })];
    expect(decide(features({ candidates }))).toEqual(refuse('disabled'));
  });

  it('refuses a control whose label looks irreversible', () => {
    for (const label of ['Delete', 'Pay now', 'Send', 'Sign out', 'Place order']) {
      const candidates = [candidate(0, 3, { label })];
      expect(decide(features({ candidates })), label).toEqual(refuse('irreversible'));
    }
    const blanked = [candidate(0, 3, { label: 'Search for …', redacted: true })];
    expect(decide(features({ candidates: blanked }))).toEqual(refuse('irreversible'));
    // A label of 40 characters may have been cut, with the word that matters past the cut:
    // "Yes, I understand and I want to permanently delete this project".
    const cut = [candidate(0, 3, { label: 'Yes, I understand and I want to permanen' })];
    expect(decide(features({ candidates: cut }))).toEqual(refuse('irreversible'));
    const whole = [candidate(0, 3, { label: 'Open the shared folder for this project' })];
    expect(decide(features({ candidates: whole }))).toEqual(retarget(0));
    for (const label of ['Bookmarks', 'Likes and replies', 'Paying users', 'Open']) {
      const candidates = [candidate(0, 3, { label })];
      expect(decide(features({ candidates })), label).toEqual(retarget(0));
    }
  });

  describe('cursor path', () => {
    // The button's left edge is 6 px right of the click. The cursor travels along y = 0.
    const candidates = [candidate(0, 6)];
    const path = (...xs: number[]) => xs.map((x, i) => ({ t: -300 + i * 50, x, y: 0 }));

    it('fires when the cursor came toward the control and stopped short', () => {
      expect(decide(features({ candidates, path: path(-200, -90, -30, -8, 0) }))).toEqual(
        retarget(0),
      );
    });

    it('fires when the cursor passed over the control and overshot', () => {
      const overshoot = [candidate(0, 6, { rect: { x: -86, y: -15, w: 80, h: 30 } })];
      expect(
        decide(features({ candidates: overshoot, path: path(-300, -150, -40, -6, 0) })),
      ).toEqual(retarget(0));
    });

    it('refuses when the cursor was at rest, since a miss ends a movement', () => {
      expect(decide(features({ candidates, path: [] }))).toEqual(refuse('path'));
      expect(decide(features({ candidates, path: path(0, 0) }))).toEqual(refuse('path'));
      expect(decide(features({ candidates, path: path(-1.5, 0) }))).toEqual(refuse('path'));
      expect(decide(features({ candidates, path: path(-2, 0) }))).toEqual(retarget(0));
    });

    it('reads a path of one sample by how far that sample was', () => {
      // A cursor that arrived just inside the 300 ms leaves a single sample.
      expect(decide(features({ candidates, path: path(-2) }))).toEqual(retarget(0));
      expect(decide(features({ candidates, path: path(-1.5) }))).toEqual(refuse('path'));
    });

    it('does not take the jitter of a resting hand for a movement', () => {
      // A pixel back and forth covers 4 px and never leaves the click point's side.
      expect(decide(features({ candidates, path: path(0, -1, 0, -1, 0) }))).toEqual(refuse('path'));
    });

    it('refuses when the cursor moved away from the control', () => {
      expect(decide(features({ candidates, path: path(5, 4, 2, 0) }))).toEqual(refuse('path'));
    });

    it('refuses when the cursor started on the control and left it', () => {
      expect(decide(features({ candidates, path: path(20, 12, 5, 0) }))).toEqual(refuse('path'));
    });
  });
});
