import { useId, useState } from 'react';

/**
 * Section navigation for a dashboard.
 *
 * A vertical rail beside the content on a wide screen, so the whole set of
 * sections is visible at once instead of scrolling sideways through a strip,
 * and the active one stays put as the panel changes. Below 900px the rail
 * becomes a horizontal scroller, because a phone has width to spare and height
 * to save.
 *
 * Takes `tabs` as [{ id, label, badge?, icon?, render() }] and calls render()
 * only for the active tab, so a heavy panel is not mounted until it is opened.
 * Falsy entries are skipped, which lets a caller drop a tab behind a flag
 * inline.
 */
export default function Tabs({ tabs, initial, label = 'Sections' }) {
  const items = tabs.filter(Boolean);
  const baseId = useId();
  const [active, setActive] = useState(initial ?? items[0]?.id);

  const current = items.find((t) => t.id === active) ?? items[0];
  if (!current) return null;

  return (
    <div className="tabs">
      <nav className="tablist" role="tablist" aria-orientation="vertical" aria-label={label}>
        {items.map((t) => {
          const on = t.id === current.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${baseId}-${t.id}`}
              aria-selected={on}
              aria-controls={`${baseId}-${t.id}-panel`}
              className="tab"
              data-on={on}
              onClick={() => setActive(t.id)}
            >
              <span className="tab-rail" aria-hidden="true" />
              {t.icon && <span className="tab-icon" aria-hidden="true">{t.icon}</span>}
              <span className="tab-text">{t.label}</span>
              {t.badge != null && <span className="tab-badge">{t.badge}</span>}
            </button>
          );
        })}
      </nav>

      <div
        role="tabpanel"
        id={`${baseId}-${current.id}-panel`}
        aria-labelledby={`${baseId}-${current.id}`}
        className="tabpanel stack"
        key={current.id}
      >
        {current.render()}
      </div>
    </div>
  );
}
