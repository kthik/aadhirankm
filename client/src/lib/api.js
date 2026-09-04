/*
 * API client.
 *
 * In the browser the app and the API share an origin, so requests go to a
 * relative /api path and the session rides in an HTTP-only cookie.
 *
 * The Android build cannot do either. Its web view is served from its own
 * origin, so it needs an absolute address for the API - which is not known at
 * build time, because it is whatever machine runs the server on the day. That
 * address is entered once on the sign-in screen and kept in localStorage. And
 * because the API is then cross-site over plain HTTP, the session cookie cannot
 * be sent; the same signed token is stored and sent as a bearer header instead.
 */

const SERVER_KEY = 'veeran.server';
const TOKEN_KEY = 'veeran.token';

/** localStorage throws in some webviews and private windows, so every use is guarded. */
function readStore(key) {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStore(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* nothing to do: the app still works for this session, just not the next */
  }
}

/** True inside the Capacitor shell, where a server address must be configured. */
export function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.()) || window.location.protocol === 'capacitor:';
}

/** Trailing slashes are trimmed so the address can be pasted in either form. */
export function normaliseServer(value) {
  const v = String(value ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `http://${v}`;
}

export function getServer() {
  return readStore(SERVER_KEY) || import.meta.env?.VITE_API_BASE || '';
}

export function setServer(value) {
  writeStore(SERVER_KEY, normaliseServer(value));
}

export function getToken() {
  return readStore(TOKEN_KEY);
}

export function setToken(value) {
  writeStore(TOKEN_KEY, value ?? '');
}

/** Thrown for any non-2xx response; carries field errors for form rendering. */
export class ApiError extends Error {
  constructor(message, { status, errors, data } = {}) {
    super(message);
    this.status = status;
    this.errors = errors ?? {};
    // Failure payloads such as the bulk importer's per-row rejections.
    this.data = data ?? {};
    this.rejected = data?.rejected;
  }
}

async function request(method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (isNativeApp()) headers['X-Veeran-Client'] = 'native';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${getServer()}/api${path}`, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // A failed fetch is a reachability problem, not an API error - say which.
    const target = getServer() || 'the server';
    throw new ApiError(`Cannot reach ${target}. Check the address and that the API is running.`, {
      status: 0,
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = data.errors ? Object.values(data.errors)[0] : null;
    throw new ApiError(data.error || first || `Request failed (${res.status})`, {
      status: res.status,
      errors: data.errors,
      data,
    });
  }
  return data;
}

/** Reachability probe for the server-address form: no session needed. */
export async function pingServer(value) {
  const base = normaliseServer(value);
  const res = await fetch(`${base}/api/health`, { method: 'GET' });
  if (!res.ok) throw new ApiError(`Server answered ${res.status} — is that the API address?`, { status: res.status });
  return res.json();
}

export const api = {
  get: (p) => request('GET', p),
  del: (p) => request('DELETE', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
};
