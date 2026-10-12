import { request } from './client'
import type { LoginResponse, User } from './types'

export const login = (username: string, password: string) =>
  request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
    auth: false,
  })
export const logout = () => request<void>('/auth/logout', { method: 'POST' })
export const getMe = (signal?: AbortSignal) =>
  request<User>('/users/me', { signal })
export const changePassword = (
  current_password: string,
  new_password: string,
) =>
  request<void>('/users/me/password', {
    method: 'POST',
    body: { current_password, new_password },
  })
