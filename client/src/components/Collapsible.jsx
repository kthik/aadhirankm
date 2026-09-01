/**
 * A card that folds. Built on <details> so open/close, keyboard access and the
 * disclosure semantics come from the browser rather than from state we manage.
 */
export default function Collapsible({ title, description, badge, defaultOpen = false, children }) {
  return (
    <details className="card collapsible" open={defaultOpen}>
      <summary>
        <span className="collapsible-title">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </span>
        {badge != null && <span className="tab-badge">{badge}</span>}
        <span className="chevron" aria-hidden="true">▾</span>
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
