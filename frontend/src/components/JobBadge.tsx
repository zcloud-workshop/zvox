import type { JobStatus } from '../api/types'

const labels: Record<JobStatus, string> = {
  pending: '排队中',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
}
export function JobBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`badge ${status}`}>
      <span className="status-dot" />
      {labels[status] ?? status}
    </span>
  )
}
