/** Builds Request objects for calling route handlers directly. */
export function jsonRequest(url: string, method: string, body?: unknown, user?: string): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-chorus-dev-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function formRequest(url: string, form: FormData, user?: string): Request {
  return new Request(`http://localhost:3000${url}`, { method: "POST", headers: user ? { "x-chorus-dev-user": user } : {}, body: form });
}

export const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
