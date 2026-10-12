import type { Session } from '../api/types'

const key = 'zvox.session'
export const sessionEvent = 'zvox:session'

export function readSession(): Session | null {
  const value = sessionStorage.getItem(key)
  if (!value) return null
  try {
    const session = JSON.parse(value) as Session
    if (
      typeof session.access_token === 'string' &&
      Date.parse(session.expires_at) > Date.now()
    ) {
      return session
    }
  } catch {
    /* Ignore an invalid stored session. */
  }
  sessionStorage.removeItem(key)
  return null
}

export function saveSession(session: Session | null) {
  if (session) {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        access_token: session.access_token,
        expires_at: session.expires_at,
      }),
    )
  } else {
    sessionStorage.removeItem(key)
  }
  window.dispatchEvent(new Event(sessionEvent))
}
