import { request } from './client'
import type { ApiKey, CreatedApiKey, LoginResponse, User } from './types'

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
export const listApiKeys = (signal?: AbortSignal) =>
  request<ApiKey[]>('/users/me/api-keys', { signal })
export const createApiKey = (name: string, expires_in_days: number | null) =>
  request<CreatedApiKey>('/users/me/api-keys', {
    method: 'POST',
    body: { name, expires_in_days },
  })
export const revokeApiKey = (id: number) =>
  request<void>(`/users/me/api-keys/${id}`, { method: 'DELETE' })
