import { request } from './client'
import type { Job, JobListItem, JobStatus } from './types'

export const createJob = (speaker_id: number, text: string) =>
  request<{ job_id: string }>('/jobs', {
    method: 'POST',
    body: { speaker_id, text },
  })
export const getJob = (id: string, signal?: AbortSignal) =>
  request<Job>(`/jobs/${encodeURIComponent(id)}`, { signal })
export const listJobs = (before?: string, signal?: AbortSignal) => {
  const query = new URLSearchParams({ limit: '20' })
  if (before) query.set('before', before)
  return request<JobListItem[]>(`/jobs?${query}`, { signal })
}
export const isActive = (status: JobStatus) =>
  status === 'pending' || status === 'running'
