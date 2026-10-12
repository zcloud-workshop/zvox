import { request } from './client'
import type { Speaker } from './types'

export const listSpeakers = (signal?: AbortSignal) =>
  request<Speaker[]>('/speakers', { signal, auth: false })

export const createSpeaker = (body: FormData) =>
  request<Speaker>('/admin/speakers', { method: 'POST', body })
