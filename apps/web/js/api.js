// API client. The web app is always served by the MyStream backend it talks to
// (same origin), so session cookies stay first-party. Desktop/TV clients point
// their window at the backend address instead of calling it cross-origin.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'include',
      signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-MyStream': '1' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'offline', 'Cannot reach the MyStream server. Check that it is running.');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const e = data?.error || {};
    const err = new ApiError(res.status, e.code || 'error', e.message || `Request failed (${res.status})`);
    if (res.status === 401) window.dispatchEvent(new CustomEvent('ms:unauthenticated'));
    if (res.status === 409 && e.code === 'no_profile') window.dispatchEvent(new CustomEvent('ms:no-profile'));
    if (res.status === 403 && e.code === 'must_change_password') window.dispatchEvent(new CustomEvent('ms:must-change'));
    throw err;
  }
  return data;
}

export const get = (p, o) => api(p, o);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}
