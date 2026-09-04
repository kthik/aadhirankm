import { useState } from 'react';
import { getServer, isNativeApp, normaliseServer, pingServer, setServer } from '../lib/api.js';
import { Banner, Field } from './ui.jsx';

/*
 * Where is the API?
 *
 * The web app never needs this - it is served by the API itself. The Android
 * build does: the server runs on somebody's laptop at the venue, so its address
 * is only knowable on the day. This panel takes it once, checks it before
 * saving, and keeps it for next launch.
 *
 * It also appears in the browser when the configuration fetch failed, because
 * then the address is genuinely in question there too.
 */

export default function ServerAddress({ onSaved }) {
  const [value, setValue] = useState(getServer());
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');

  async function check() {
    setState('busy');
    setMessage('');
    try {
      await pingServer(value);
      setServer(value);
      setState('ok');
      setMessage(`Connected to ${normaliseServer(value)}. Sign in below.`);
      onSaved?.(normaliseServer(value));
    } catch (err) {
      setState('error');
      setMessage(err.message);
    }
  }

  return (
    <div className="server-setup">
      <h3>Server address</h3>
      <p className="muted">
        {isNativeApp()
          ? 'Enter the address of the machine running Veeran on this network. Ask the organiser if you do not know it.'
          : 'The app could not reach its API. Enter the address it is running on.'}
      </p>

      <Field
        label="Address"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="192.168.1.20:4000"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck="false"
        hint="Host and port. http:// is added for you."
      />

      <div className="actions">
        <button type="button" onClick={check} disabled={state === 'busy' || !value.trim()}>
          {state === 'busy' ? 'Checking…' : 'Connect'}
        </button>
      </div>

      {message && <Banner kind={state === 'ok' ? 'ok' : 'error'}>{message}</Banner>}
    </div>
  );
}
