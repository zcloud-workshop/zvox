export type Role = 'admin' | 'user'
export interface User {
  id: number
  username: string
  role: Role
  is_active: boolean
  created_at: string
}
export interface Session {
  access_token: string
  expires_at: string
}
export interface LoginResponse extends Session {
  token_type: 'bearer'
  user: User
}
export interface ApiKey {
  id: number
  name: string
  prefix: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
}
export interface CreatedApiKey extends ApiKey {
  key: string
}
export interface Speaker {
  id: number
  name: string | null
  description: string | null
  icon_url: string | null
}
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'
export interface JobListItem {
  id: string
  created_at: string
  status: JobStatus
  text: string
  speaker_id: number
  speaker_name: string | null
  speaker_icon_url: string | null
  started_at: string | null
  finished_at: string | null
  duration_seconds: number | null
}
export interface Job extends JobListItem {
  user_id: number | null
  speaker_description: string | null
  result_url: string | null
  error: string | null
}
export interface SyncStatus {
  running: boolean
  last_result: {
    imported: number
    deleted: number
    errors: { key: string | null; error: string }[]
  } | null
}
export type ModelStatus =
  | { status: 'ready'; path: string }
  | {
      downloading: boolean
      progress: string | null
      path: string
      error: string | null
    }
export type ModelStart = {
  status: 'ready' | 'downloading' | 'download_started'
  path?: string
}
