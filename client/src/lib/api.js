const BASE = '/api';

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
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

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

export const api = {
  get: (p) => request('GET', p),
  del: (p) => request('DELETE', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
};
