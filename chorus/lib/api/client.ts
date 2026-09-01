"use client";
/** Typed fetch wrappers for the routes in §7. All throw ApiClientError on non-2xx. */

export class ApiClientError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
  if (!res.ok) {
    let msg = res.statusText;
    let details: unknown;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
      details = data.details;
    } catch {
      /* non-JSON error */
    }
    throw new ApiClientError(res.status, msg, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, { method: "POST", body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
