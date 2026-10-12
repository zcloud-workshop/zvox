import { request } from './client'
import type { ModelStart, ModelStatus, Role, SyncStatus, User } from './types'

export const listUsers = (signal?: AbortSignal) =>
  request<User[]>('/admin/users', { signal })
export const createUser = (username: string, password: string, role: Role) =>
  request<User>('/admin/users', {
    method: 'POST',
    body: { username, password, role },
  })
export const updateUser = (
  id: number,
  body: { role?: Role; is_active?: boolean },
) => request<User>(`/admin/users/${id}`, { method: 'PATCH', body })
export const resetPassword = (id: number, password: string) =>
  request<void>(`/admin/users/${id}/password`, {
    method: 'POST',
    body: { password },
  })
export const getSyncStatus = (signal?: AbortSignal) =>
  request<SyncStatus>('/admin/speakers/sync/status', { signal })
export const startSync = () =>
  request<{ status: 'submitted' | 'already_running' }>('/admin/speakers/sync', {
    method: 'POST',
  })
export const getModelStatus = (signal?: AbortSignal) =>
  request<ModelStatus>('/admin/model/status', { signal })
export const startModel = () => request<ModelStart>('/admin/model')
