import { useEffect } from 'react';

/** Labelled input that renders its own server-side error underneath. */
export function Field({ label, error, hint, children, ...input }) {
  return (
    <label className={`field${error ? ' invalid' : ''}`}>
      <span>{label}</span>
      {children ?? <input {...input} />}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="error-text">{error}</div>}
    </label>
  );
}

export function Banner({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`banner ${kind}`}>{children}</div>;
}

/** Multi-select for EventMaster rendered as tappable chips (mobile-friendly). */
export function EventPicker({ events, value, onChange, error }) {
  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <span>Events participating</span>
      <div className="chips">
        {events.map((e) => (
          <label key={e.eventId} className="chip" data-on={value.includes(e.eventId)}>
            <input
              type="checkbox"
              checked={value.includes(e.eventId)}
              onChange={() => toggle(e.eventId)}
            />
            {e.name}
          </label>
        ))}
        {events.length === 0 && <span className="muted">No active events yet.</span>}
      </div>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Read-only credential row with a copy button — used by the post-signup popup. */
export function Credential({ label, value }) {
  return (
    <div className="cred">
      <div>
        <div className="k">{label}</div>
        <div className="v">{value}</div>
      </div>
      <button
        type="button"
        className="ghost"
        onClick={() => navigator.clipboard?.writeText(value)}
      >
        Copy
      </button>
    </div>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="card stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
