import type { SpeakerStatus } from '../api/types'

const labels: Record<SpeakerStatus, string> = {
  private: '私有',
  pending: '审核中',
  approved: '已公开',
  rejected: '未通过',
}

export function SpeakerStatusBadge({ status }: { status: SpeakerStatus }) {
  return (
    <span className={`badge ${status}`}>
      <span className="status-dot" />
      {labels[status] ?? status}
    </span>
  )
}
