// Plays one planned click with a real mouse on a real page. The plan comes from
// the synthetic generator: a scene of controls, where the press lands, how the
// pointer arrived and what the user does next. Here the scene is drawn as real
// elements and the extension measures everything itself.
import type { Page } from '@playwright/test';
import type { Point } from '../src/core/geometry';
import type { Click, Control } from '../synth/generate';

export const VIEWPORT = { w: 1280, h: 800 };

/** Longer than the 50 ms the content script waits for a page reaction. */
const SETTLE_MS = 130;

/** With no pointer sample in the last 300 ms, the press comes from rest. */
const REST_MS = 330;

/** A control as the fixture page draws it, in viewport px. */
export type Drawn = Pick<Control, 'kind' | 'tag' | 'role' | 'type' | 'label' | 'disabled'> & {
  x: number;
  y: number;
  w: number;
  h: number;
};

declare global {
  interface Window {
    render(controls: Drawn[], options: { churn: boolean; reaction: string | null }): void;
  }
}

/** Where the scene's own origin goes, so that the scene sits in the middle of the viewport. */
export function originOf(scene: Control[]): Point {
  const left = Math.min(...scene.map((c) => c.rect.x));
  const top = Math.min(...scene.map((c) => c.rect.y));
  const right = Math.max(...scene.map((c) => c.rect.x + c.rect.w));
  const bottom = Math.max(...scene.map((c) => c.rect.y + c.rect.h));
  return {
    x: Math.round(VIEWPORT.w / 2 - (left + right) / 2),
    y: Math.round(VIEWPORT.h / 2 - (top + bottom) / 2),
  };
}

function clamp(point: Point): Point {
  return {
    x: Math.min(VIEWPORT.w - 2, Math.max(1, point.x)),
    y: Math.min(VIEWPORT.h - 2, Math.max(1, point.y)),
  };
}

const now = () => performance.now();

async function until(time: number): Promise<void> {
  const wait = time - now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** When a played click started and ended, in epoch ms, to find its records in the log. */
export interface Played {
  from: number;
  to: number;
  origin: Point;
}

/** Loads a fresh page, draws the click's scene and plays the click on it. */
export async function play(page: Page, url: string, click: Click): Promise<Played> {
  const { plan, site } = click;
  const origin = originOf(plan.scene);
  const at = (point: Point) => clamp({ x: origin.x + point.x, y: origin.y + point.y });
  const p = at(plan.p);

  // A fresh page for each click, so the next click is never taken for this one's retry.
  await page.goto(url);
  const reaction = site.churn
    ? null
    : plan.reaction.focus
      ? 'focus'
      : plan.reaction.mutation
        ? 'mutation'
        : null;
  await page.evaluate(([controls, options]) => window.render(controls, options), [
    plan.scene.map(({ rect, kind, tag, role, type, label, disabled }) => ({
      x: origin.x + rect.x,
      y: origin.y + rect.y,
      w: rect.w,
      h: rect.h,
      kind,
      tag,
      role,
      type,
      label,
      disabled,
    })),
    { churn: site.churn, reaction },
  ] as const);
  const from = Date.now();

  // The pointer arrives along the planned path, in real time.
  let down: number;
  const [first] = plan.path;
  if (first) {
    const start = now();
    for (const sample of plan.path) {
      await until(start + sample.t - first.t);
      await page.mouse.move(p.x + sample.x, p.y + sample.y);
    }
    down = start - first.t;
  } else {
    await page.mouse.move(p.x, p.y);
    down = now() + REST_MS;
  }
  await until(down);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  down = now();

  // A second press cuts a slow first one short, as a double-click does.
  const second = plan.second && { q: at(plan.second.q), at: down + plan.second.dt };
  const held = second ? Math.min(plan.press.ms, plan.second!.dt - 50) : plan.press.ms;
  if (plan.press.move > 0.05) {
    await until(down + held / 2);
    await page.mouse.move(p.x + plan.press.move, p.y, { steps: plan.press.move > 8 ? 6 : 1 });
  }
  await until(down + held);
  await page.mouse.up();

  if (second) {
    await until(second.at - 40);
    await page.mouse.move(second.q.x, second.q.y, { steps: 3 });
    await until(second.at);
    await page.mouse.down();
    await until(second.at + 60);
    await page.mouse.up();
  }
  await until(now() + SETTLE_MS);
  return { from, to: Date.now(), origin };
}
