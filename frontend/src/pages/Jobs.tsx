import { useCallback, useRef } from 'react'
import { Link } from 'react-router'
import { getJob, isActive, listJobs } from '../api/jobs'
import type { JobListItem } from '../api/types'
import { useAuth } from '../auth/context'
import { Avatar } from '../components/Avatar'
import { EmptyState, ErrorNotice, PageHeading } from '../components/Feedback'
import { JobBadge } from '../components/JobBadge'
import { useAction } from '../hooks/useAction'
import { useQuery } from '../hooks/useQuery'

interface JobPage {
  items: JobListItem[]
  cursor?: string
  more: boolean
}
const pollJobs = (page: JobPage) =>
  page.items.some((item) => isActive(item.status)) ? 5000 : 0
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
export function Jobs() {
  const { user } = useAuth()
  const stored = useRef<JobPage | undefined>(undefined)
  const action = useAction()
  const load = useCallback(async (signal: AbortSignal) => {
    const first = await listJobs(undefined, signal)
    const old = stored.current
    const ids = new Set(first.map((item) => item.id))
    const tail = await Promise.all(
      (old?.items ?? [])
        .filter((item) => !ids.has(item.id))
        .map((item) =>
          isActive(item.status) ? getJob(item.id, signal) : item,
        ),
    )
    const latest = stored.current
    const updates = new Map(tail.map((item) => [item.id, item]))
    const page = {
      items: [
        ...first,
        ...(latest?.items ?? [])
          .filter((item) => !ids.has(item.id))
          .map((item) => updates.get(item.id) ?? item),
      ],
      cursor: latest?.cursor ?? first.at(-1)?.created_at,
      more: latest?.cursor ? latest.more : first.length === 20,
    }
    if (!signal.aborted) stored.current = page
    return page
  }, [])
  const query = useQuery(load, pollJobs)
  function loadMore() {
    void action.run(async () => {
      const next = await listJobs(stored.current?.cursor)
      const current = stored.current!
      const ids = new Set(current.items.map((item) => item.id))
      stored.current = {
        items: [...current.items, ...next.filter((item) => !ids.has(item.id))],
        cursor: next.at(-1)?.created_at ?? current.cursor,
        more: next.length === 20,
      }
      query.reload()
    })
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR CREATIONS"
        title={user?.role === 'admin' ? '全部作品' : '我的作品'}
        description={
          user?.role === 'admin'
            ? '查看所有用户的语音任务和生成结果.'
            : '每一次表达, 都在这里留下声音.'
        }
      >
        <Link to="/" className="button primary">
          创建语音
        </Link>
      </PageHeading>
      <ErrorNotice message={query.error || action.error} retry={query.reload} />
      <section className="panel jobs-panel">
        <div className="section-title">
          <h2>生成记录</h2>
          <button className="text-button" onClick={query.reload}>
            刷新列表
          </button>
        </div>
        {query.loading ? (
          <EmptyState title="正在加载作品" description="请稍候." />
        ) : query.data?.items.length === 0 ? (
          <EmptyState
            title="第一段声音, 从这里开始"
            description="选择喜欢的音色, 把想法变成声音."
          >
            <Link className="button secondary" to="/">
              去创作
            </Link>
          </EmptyState>
        ) : null}
        <div className="job-list">
          {query.data?.items.map((job) => (
            <Link to={`/jobs/${job.id}`} className="job-row" key={job.id}>
              <Avatar
                name={job.speaker_name ?? '音色'}
                url={job.speaker_icon_url}
                id={job.speaker_id}
              />
              <div className="job-summary">
                <strong>{job.text || '空文本任务'}</strong>
                <span>
                  {job.speaker_name ?? `音色 ${job.speaker_id}`}
                  <span className="meta-separator">/</span>
                  <time dateTime={job.created_at}>
                    {dateFormatter.format(new Date(job.created_at))}
                  </time>
                </span>
              </div>
              <JobBadge status={job.status} />
              <span className="row-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          ))}
        </div>
        {query.data?.more && (
          <div className="load-more">
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={loadMore}
            >
              {action.busy ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </section>
    </>
  )
}
