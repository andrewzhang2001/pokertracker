// Bridges Clerk's session token to the plain (non-React) fetch helpers in
// handsApi. ClerkProvider puts the active Clerk instance on window.Clerk, so by
// the time the signed-in app issues a request the session token is available.
declare global {
  interface Window {
    Clerk?: { session?: { getToken: (opts?: unknown) => Promise<string | null> } | null }
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await window.Clerk?.session?.getToken?.()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export {}
