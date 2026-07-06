/**
 * Session-expiry signalling: the HTTP layer announces a 401 as a window
 * event instead of importing the router — lib/ stays framework-free and the
 * shell decides how to react (redirect to /login, keeping the intent in
 * ?next).
 */
export const UNAUTHENTICATED_EVENT = "os:unauthenticated";

export function notifyUnauthenticated(): void {
  window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
}
