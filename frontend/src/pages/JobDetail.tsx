import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { createJob, getJob, isActive } from '../api/jobs'
import type { Job } from '../api/types'
import { Avatar } from '../components/Avatar'
import { EmptyState, ErrorNotice, PageHeading } from '../components/Feedback'
import { JobBadge } from '../components/JobBadge'
import { useAction } from '../hooks/useAction'
import { useQuery } from '../hooks/useQuery'

const pollJob = (job: Job) => (isActive(job.status) ? 2000 : 0)
export function JobDetail() {
  const { id = '' } = useParams()
  return <JobContent key={id} id={id} />
}
function JobContent({ id }: { id: string }) {
  const navigate = useNavigate()
  const load = useCallback((signal: AbortSignal) => getJob(id, signal), [id])
  const query = useQuery(load, pollJob)
  const action = useAction()
  const [freshUrl, setFreshUrl] = useState<string | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [audioError, setAudioError] = useState('')
  const [audioVersion, setAudioVersion] = useState(0)
  const autoRefreshed = useRef(false)
  const job = query.data
  function retryJob() {
    if (!job || job.status !== 'failed') return
    void action.run(async () => {
      const result = await createJob(job.speaker_id, job.text)
      navigate(`/jobs/${result.job_id}`)
    })
  }
  function refreshAudio(forFile = false) {
    void action.run(async () => {
      setAudioError('')
      const result = await getJob(id)
      if (!result.result_url) throw new Error('当前任务暂无可播放的音频.')
      if (forFile) setFileUrl(result.result_url)
      else {
        setFreshUrl(result.result_url)
        setAudioVersion((value) => value + 1)
      }
    })
  }
  function onAudioError() {
    if (!autoRefreshed.current) {
      autoRefreshed.current = true
      refreshAudio()
    } else setAudioError('音频暂时无法播放, 请刷新链接后重试.')
  }
  return (
    <>
      <Link className="back-link" to="/jobs">
        返回作品列表
      </Link>
      <PageHeading
        eyebrow="CREATION DETAILS"
        title="聆听你的创作"
        description="从文字到声音, 让表达多一种可能."
      >
        {job && <JobBadge status={job.status} />}
      </PageHeading>
      <ErrorNotice message={query.error} retry={query.reload} />
      {query.loading && (
        <EmptyState title="正在加载任务" description="请稍候." />
      )}
      {job && (
        <div className="detail-grid">
          <section className="panel">
            <div className="section-title">
              <h2>原始文本</h2>
              <span className="muted small">
                {Array.from(job.text).length} 字符
              </span>
            </div>
            <p className="full-text">{job.text}</p>
            <div className="detail-meta">
              <span>任务 ID</span>
              <code>{job.id}</code>
              <span>创建时间</span>
              <time dateTime={job.created_at}>
                {new Date(job.created_at).toLocaleString('zh-CN')}
              </time>
            </div>
          </section>
          <section className="panel result-panel">
            <div className="section-title">
              <h2>语音结果</h2>
            </div>
            <div className="selected-voice">
              <Avatar
                name={job.speaker_name ?? '音色'}
                url={job.speaker_icon_url}
                id={job.speaker_id}
              />
              <div>
                <strong>{job.speaker_name ?? `音色 ${job.speaker_id}`}</strong>
                <span className="muted small">
                  {job.speaker_description || '你的专属表达'}
                </span>
              </div>
            </div>
            {isActive(job.status) && (
              <EmptyState
                title={
                  job.status === 'pending' ? '声音正在排队' : '正在赋予文字声音'
                }
                description={
                  job.status === 'pending'
                    ? '轮到此任务时将自动开始生成.'
                    : '请稍候, 完成后将在这里显示结果.'
                }
              />
            )}
            {job.status === 'failed' && (
              <>
                <ErrorNotice message={job.error || '生成失败, 请重试任务.'} />
                <ErrorNotice message={action.error} />
                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={action.busy}
                    onClick={retryJob}
                  >
                    {action.busy ? '正在提交...' : '重试任务'}
                  </button>
                </div>
                <p className="small muted">
                  使用相同文本和音色创建新任务, 保留本次失败记录.
                </p>
              </>
            )}
            {job.status === 'completed' &&
              (job.result_url ? (
                <div className="audio-result">
                  <p className="eyebrow">READY TO LISTEN</p>
                  <h3>声音已就绪</h3>
                  <audio
                    key={audioVersion}
                    controls
                    preload="metadata"
                    src={freshUrl ?? job.result_url}
                    onError={onAudioError}
                    aria-label="生成的语音"
                  />
                  <ErrorNotice message={audioError || action.error} />
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={action.busy}
                      onClick={() => refreshAudio()}
                    >
                      刷新播放链接
                    </button>
                    <button
                      className="button primary"
                      disabled={action.busy}
                      onClick={() => refreshAudio(true)}
                    >
                      获取音频文件
                    </button>
                  </div>
                  {fileUrl && (
                    <a
                      className="file-link"
                      href={fileUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开音频文件 / 另存为 WAV
                    </a>
                  )}
                  <p className="small muted">链接短期有效. 失效后可重新获取.</p>
                </div>
              ) : (
                <EmptyState
                  title="音频链接暂不可用"
                  description="请刷新任务后重试."
                >
                  <button className="button secondary" onClick={query.reload}>
                    刷新任务
                  </button>
                </EmptyState>
              ))}
          </section>
        </div>
      )}
    </>
  )
}
