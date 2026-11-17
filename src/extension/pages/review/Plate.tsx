// A drawing of one logged click, to scale: the click point, what was near it,
// the control heyo would pick, and how the cursor arrived.
import { nearestPointInRect } from '../../../core/geometry';
import type { Candidate } from '../../../core/types';
import { gapLabelSpot, nameOf, type Fire } from './data';

/** Page px shown on each side of the click point. */
const HALF = 56;

/** Height of label text, in page px. */
const TEXT = 3.6;

function Label({ candidate, picked, id }: { candidate: Candidate; picked: boolean; id: string }) {
  const { rect } = candidate;
  // Place the label in the part of the box that is inside the drawing.
  const left = Math.max(rect.x, -HALF);
  const top = Math.max(rect.y, -HALF);
  const bottom = Math.min(rect.y + rect.h, HALF);
  if (bottom - top < TEXT + 1 || rect.x + rect.w - left < TEXT * 2) return null;
  return (
    <g clip-path={`url(#${id})`}>
      <text
        class={picked ? 'plate-label plate-label-picked' : 'plate-label'}
        x={left + 2}
        y={(top + bottom) / 2}
        dominant-baseline="central"
      >
        {nameOf(candidate)}
      </text>
    </g>
  );
}

function Box({ candidate, picked, id }: { candidate: Candidate; picked: boolean; id: string }) {
  const { rect, kind } = candidate;
  const cls = picked ? 'plate-box plate-box-picked' : `plate-box plate-box-${kind}`;
  return (
    <g>
      <clipPath id={id}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      </clipPath>
      <rect class={cls} x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="1.2" />
      {kind === 'control' && <Label candidate={candidate} picked={picked} id={id} />}
    </g>
  );
}

/** The measured gap between the click and the picked control, drawn like a dimension line. */
function Gap({ picked, others }: { picked: Candidate; others: Candidate[] }) {
  const end = nearestPointInRect({ x: 0, y: 0 }, picked.rect);
  const length = Math.hypot(end.x, end.y);
  if (length < 0.05) {
    return (
      <text class="plate-gap-text" x="5" y="-5">
        inside its box
      </text>
    );
  }
  const ux = end.x / length;
  const uy = end.y / length;
  const text = `${picked.dist} px`;
  const spot = gapLabelSpot({ x: ux, y: uy }, text.length * TEXT * 0.62, TEXT, others);
  return (
    <g>
      <line class="plate-gap" x1="0" y1="0" x2={end.x} y2={end.y} />
      <line
        class="plate-gap"
        x1={end.x - uy * 2}
        y1={end.y + ux * 2}
        x2={end.x + uy * 2}
        y2={end.y - ux * 2}
      />
      {spot && (
        <text
          class="plate-gap-text"
          x={spot.x}
          y={spot.y}
          text-anchor={spot.anchor}
          dominant-baseline="central"
        >
          {text}
        </text>
      )}
    </g>
  );
}

export function Plate({ fire }: { fire: Fire }) {
  const { record, picked } = fire;
  const { candidates, path } = record.features;
  const others = candidates.filter((c) => c.id !== picked.id);
  const trail = path.map((s) => `${s.x},${s.y}`).join(' ');
  const size = 2 * HALF;
  return (
    <svg
      class="plate"
      viewBox={`${-HALF} ${-HALF} ${size} ${size}`}
      role="img"
      aria-label={`Drawing of the click. It landed ${picked.dist} px from ${nameOf(picked)}.`}
    >
      <defs>
        <pattern id="plate-minor" width="5" height="5" patternUnits="userSpaceOnUse">
          <path class="plate-grid-minor" d="M5 0H0V5" />
        </pattern>
        <pattern id="plate-major" width="25" height="25" patternUnits="userSpaceOnUse">
          <path class="plate-grid-major" d="M25 0H0V25" />
        </pattern>
        <pattern
          id="plate-hatch"
          width="3"
          height="3"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line class="plate-hatch" x1="0" y1="0" x2="0" y2="3" />
        </pattern>
      </defs>
      <rect class="plate-paper" x={-HALF} y={-HALF} width={size} height={size} />
      <rect fill="url(#plate-minor)" x={-HALF} y={-HALF} width={size} height={size} />
      <rect fill="url(#plate-major)" x={-HALF} y={-HALF} width={size} height={size} />

      {others.map((c) => (
        <Box key={c.id} candidate={c} picked={false} id={`clip-${record.id}-${c.id}`} />
      ))}
      <Box candidate={picked} picked id={`clip-${record.id}-${picked.id}`} />

      {path.length > 1 && <polyline class="plate-path" points={trail} />}
      {path.map((s, i) => (
        <circle key={i} class="plate-path-dot" cx={s.x} cy={s.y} r="0.55" />
      ))}

      <Gap picked={picked} others={others} />

      <g class="plate-click">
        <circle r="2.1" />
        <path d="M-4.2 0H4.2M0 -4.2V4.2" />
      </g>

      <g class="plate-scale">
        <path d={`M${-HALF + 5} ${HALF - 6.5}v2h10v-2`} />
        <text x={-HALF + 17} y={HALF - 4.5} dominant-baseline="central">
          10 px
        </text>
      </g>
    </svg>
  );
}
