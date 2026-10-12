import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getMe } from '../api/auth'
import { messageOf } from '../api/client'
import type { LoginResponse, User } from '../api/types'
import { AuthContext } from './context'
import { readSession, saveSession, sessionEvent } from './session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(readSession)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!!session)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const clear = useCallback((message = '') => {
    saveSession(null)
    setUser(null)
    setError('')
    setNotice(message)
  }, [])

  useEffect(() => {
    const onSession = () => {
      const next = readSession()
      setSession(next)
      if (!next) {
        setUser(null)
        setLoading(false)
        setError('')
      } else {
        setLoading(true)
        setError('')
      }
    }
    window.addEventListener(sessionEvent, onSession)
    return () => window.removeEventListener(sessionEvent, onSession)
  }, [])

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    void getMe(controller.signal)
      .then((current) => {
        if (
          !controller.signal.aborted &&
          readSession()?.access_token === session.access_token
        )
          setUser(current)
      })
      .catch((error) => {
        if (
          !controller.signal.aborted &&
          readSession()?.access_token === session.access_token
        )
          setError(messageOf(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    const timer = setTimeout(
      () => clear('登录已过期, 请重新登录.'),
      Math.max(0, Date.parse(session.expires_at) - Date.now()),
    )
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [session, revision, clear])

  const refresh = async () => {
    if (!user) {
      setLoading(true)
      setError('')
      setRevision((value) => value + 1)
      return
    }
    const token = readSession()?.access_token
    try {
      const current = await getMe()
      if (token && readSession()?.access_token === token) {
        setUser(current)
        setError('')
      }
    } catch (error) {
      if (token && readSession()?.access_token === token)
        setError(messageOf(error))
    }
  }
  function accept(response: LoginResponse) {
    saveSession(response)
    setUser(response.user)
    setNotice('')
    setError('')
  }
  return (
    <AuthContext.Provider
      value={{ user, loading, error, notice, accept, clear, refresh }}
    >
      {children}
    </AuthContext.Provider>
  )
}
