import { request } from './client'
import type { Speaker } from './types'

export const listSpeakers = (signal?: AbortSignal) =>
  request<Speaker[]>('/speakers', { signal })

export const listPlazaSpeakers = (signal?: AbortSignal) =>
  request<Speaker[]>('/speakers/plaza', { signal })

export const listMySpeakers = (signal?: AbortSignal) =>
  request<Speaker[]>('/speakers/mine', { signal })

export const createMySpeaker = (body: FormData) =>
  request<Speaker>('/speakers', { method: 'POST', body })

export const submitSpeaker = (id: number) =>
  request<void>(`/speakers/${id}/submit`, { method: 'POST' })

export const withdrawSpeaker = (id: number) =>
  request<void>(`/speakers/${id}/withdraw`, { method: 'POST' })

export const listSpeakerReviews = (signal?: AbortSignal) =>
  request<Speaker[]>('/admin/speakers/reviews', { signal })

export const reviewSpeaker = (
  id: number,
  decision: 'approve' | 'reject',
  comment?: string,
) =>
  request<Speaker>(`/admin/speakers/${id}/review`, {
    method: 'POST',
    body: { decision, comment },
  })

export const createSpeaker = (body: FormData) =>
  request<Speaker>('/admin/speakers', { method: 'POST', body })
