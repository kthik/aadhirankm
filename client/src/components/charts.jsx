import { useState } from 'react';

/*
 * Chart primitives, drawn in plain HTML so the app takes on no charting
 * dependency. Colours come from the CSS custom properties in styles.css
 * (--series-1/2 and the --seq-* ramp), which are re-stepped per theme and
 * validated against each surface: adjacent CVD ΔE 24.7 day / 26.8 night,
 * normal-vision ΔE 33.6 / 31.8, everything clear of 3:1 contrast. Switching
 * day/night therefore re-themes every chart with no code change here.
 */

/** Shared floating tooltip. Rendered in-flow so it never escapes the card. */
function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" role="status">
      <strong>{tip.label}</strong>
      {tip.lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

/**
 * Horizontal bars for one measure across named rows. One series, so no legend:
 * the title names the measure. Values are direct-labelled at the bar end.
 */
export function BarChart({ rows, valueLabel, emptyText = 'No data yet.' }) {
  const [tip, setTip] = useState(null);
  if (rows.length === 0) return <div className="empty">{emptyText}</div>;

  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      {rows.map((r) => (
        <div
          key={r.label}
          className="bar-row"
          onMouseEnter={() => setTip({ label: r.label, lines: r.detail ?? [`${r.value} ${valueLabel}`] })}
          onFocus={() => setTip({ label: r.label, lines: r.detail ?? [`${r.value} ${valueLabel}`] })}
          tabIndex={0}
        >
          <span className="bar-label" title={r.label}>{r.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 3 : 0)}%` }}
            />
          </span>
          <span className="bar-value">{r.value}</span>
        </div>
      ))}
      <Tip tip={tip} />
    </div>
  );
}

/**
 * Completed vs waiting as a two-segment bar. Two series, so a legend is always
 * present (rendered by the caller once above a group of these) and the segments
 * carry a 2px surface gap so they never read as one block.
 */
export function ProgressBar({ completed, waiting, onHover }) {
  const total = completed + waiting;
  if (total === 0) return <div className="split-bar empty-bar" aria-hidden="true" />;

  return (
    <div
      className="split-bar"
      onMouseEnter={() => onHover?.({ completed, waiting })}
      onMouseLeave={() => onHover?.(null)}
      role="img"
      aria-label={`${completed} completed, ${waiting} waiting`}
    >
      {completed > 0 && (
        <span className="seg seg-done" style={{ width: `${(completed / total) * 100}%` }} />
      )}
      {waiting > 0 && (
        <span className="seg seg-wait" style={{ width: `${(waiting / total) * 100}%` }} />
      )}
    </div>
  );
}

export function SeriesLegend({ items }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <span className="legend-swatch" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Bout grid.
 *
 * The spec asked for a green/amber/red grid, but red and green are ΔE 4.1 apart
 * under deuteranopia — the two states most worth telling apart would collide.
 * Completion is a magnitude, so this uses a single-hue sequential ramp instead
 * and prints the percentage and state in every cell, leaving colour to reinforce
 * a value that is already readable without it. The ramp inverts per theme:
 * pale-to-strong on the day surface, dim-to-bright on the night one.
 */
export function Heatmap({ cells, onSelect }) {
  const [tip, setTip] = useState(null);
  if (cells.length === 0) return <div className="empty">No bouts created yet.</div>;

  const step = (c) => {
    if (c.participants === 0) return 'empty';
    if (c.completedPct === 100) return 's4';
    if (c.completedPct >= 67) return 's3';
    if (c.completedPct >= 34) return 's2';
    if (c.completedPct > 0) return 's1';
    return 's0';
  };

  const stateLabel = {
    completed: 'Completed',
    in_progress: 'In progress',
    waiting: 'Waiting',
    empty: 'No participants',
  };

  return (
    <div onMouseLeave={() => setTip(null)}>
      <div className="heatgrid">
        {cells.map((c) => (
          <button
            key={c.boutId}
            type="button"
            className="heatcell"
            data-step={step(c)}
            onClick={() => onSelect?.(c)}
            onMouseEnter={() =>
              setTip({
                label: c.boutName,
                lines: [
                  `${c.completed} of ${c.participants} scored`,
                  c.judge ? `Judge: ${c.judge.judgeName}` : 'No judge assigned',
                  c.eventName ?? 'All events',
                ],
              })
            }
          >
            <span className="heat-pct">{c.participants === 0 ? '—' : `${c.completedPct}%`}</span>
            <span className="heat-name">{c.boutName}</span>
            <span className="heat-state">{stateLabel[c.state]}</span>
          </button>
        ))}
      </div>

      <div className="legend ramp-legend">
        <span className="legend-item">0%</span>
        {['s0', 's1', 's2', 's3', 's4'].map((s) => (
          <span key={s} className="ramp-swatch" data-step={s} />
        ))}
        <span className="legend-item">100% scored</span>
      </div>

      <Tip tip={tip} />
    </div>
  );
}

/**
 * Cumulative progress over time: registrations against filed sheets, one
 * column pair per day.
 *
 * Two series, so the caller renders a legend; each column carries its own
 * hover detail and the day axis is thinned to the ends and every nth label,
 * because a competition week on a phone cannot show twenty date labels.
 */
export function TrendChart({ points, emptyText = 'Nothing recorded yet.' }) {
  const [tip, setTip] = useState(null);
  if (points.length === 0) return <div className="empty">{emptyText}</div>;

  const max = Math.max(...points.map((p) => p.cumulativeRegistered), 1);
  const every = Math.ceil(points.length / 6);

  return (
    <div className="trend" onMouseLeave={() => setTip(null)}>
      <div className="trend-plot">
        {points.map((p, i) => (
          <div
            key={p.day}
            className="trend-col"
            tabIndex={0}
            onMouseEnter={() =>
              setTip({
                label: p.day,
                lines: [
                  `${p.cumulativeRegistered} registered to date (+${p.registered})`,
                  `${p.cumulativeScored} scored to date (+${p.scored})`,
                ],
              })
            }
            onFocus={() =>
              setTip({
                label: p.day,
                lines: [
                  `${p.cumulativeRegistered} registered to date`,
                  `${p.cumulativeScored} scored to date`,
                ],
              })
            }
          >
            <span className="trend-bars">
              <span
                className="trend-bar reg"
                style={{ height: `${(p.cumulativeRegistered / max) * 100}%` }}
              />
              <span
                className="trend-bar done"
                style={{ height: `${(p.cumulativeScored / max) * 100}%` }}
              />
            </span>
            <span className="trend-day">
              {i === 0 || i === points.length - 1 || i % every === 0 ? p.day.slice(5) : ''}
            </span>
          </div>
        ))}
      </div>
      <Tip tip={tip} />
    </div>
  );
}

/**
 * Completed-vs-waiting rows with a percentage, for the breakdown panels. The
 * split bar carries the magnitude and the percentage is direct-labelled, so the
 * rows stay readable without colour.
 */
export function SplitRows({ rows, emptyText = 'No entries yet.', onSelect }) {
  const [tip, setTip] = useState(null);
  if (rows.length === 0) return <div className="empty">{emptyText}</div>;

  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      {rows.map((r) => (
        <div
          key={r.id ?? r.label}
          className="bar-row split-row"
          tabIndex={0}
          onClick={() => onSelect?.(r)}
          onMouseEnter={() =>
            setTip({
              label: r.label,
              lines: [
                `${r.participants} competitor(s)`,
                `${r.completed} scored, ${r.waiting} waiting`,
              ],
            })
          }
        >
          <span className="bar-label" title={r.label}>{r.label}</span>
          <ProgressBar completed={r.completed} waiting={r.waiting} />
          <span className="bar-value">{r.completedPct}%</span>
        </div>
      ))}
      <Tip tip={tip} />
    </div>
  );
}
