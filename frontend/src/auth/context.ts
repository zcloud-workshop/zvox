import { createContext, useContext } from 'react'
import type { LoginResponse, User } from '../api/types'

interface AuthState {
  user: User | null
  loading: boolean
  error: string
  notice: string
  accept: (response: LoginResponse) => void
  clear: (notice?: string) => void
  refresh: () => Promise<void>
}
export const AuthContext = createContext<AuthState | null>(null)
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('AuthProvider is required')
  return context
}
