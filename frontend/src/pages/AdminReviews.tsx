import { useState } from 'react'
import { listSpeakerReviews, reviewSpeaker } from '../api/speakers'
import { Avatar } from '../components/Avatar'
import { EmptyState, ErrorNotice, PageHeading } from '../components/Feedback'
import { useAction } from '../hooks/useAction'
import { useQuery } from '../hooks/useQuery'

export function AdminReviews() {
  const reviews = useQuery(listSpeakerReviews)
  const action = useAction()
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [notice, setNotice] = useState('')
  const rows = reviews.data ?? []

  async function run(next: () => Promise<unknown>, message: string) {
    await action.run(async () => {
      setNotice('')
      await next()
      setNotice(message)
      reviews.reload()
    })
  }

  return (
    <>
      <PageHeading
        eyebrow="SPEAKER REVIEW"
        title="音色审核."
        description="审核创作者提交的广场公开申请; 通过后音色对所有用户可见可用."
      >
        <span className="heading-label">
          <span className="status-dot" /> 待审核 {rows.length} 个
        </span>
      </PageHeading>
      <section className="panel" aria-labelledby="reviews-title">
        <div className="section-title">
          <div>
            <span className="step">01</span>
            <h2 id="reviews-title">待审核音色</h2>
          </div>
          <span className="count-tag">{rows.length} 个</span>
        </div>
        <ErrorNotice message={reviews.error} retry={reviews.reload} />
        {reviews.loading ? (
          <EmptyState title="正在加载" description="马上就好." />
        ) : !reviews.error && rows.length === 0 ? (
          <EmptyState title="暂无待审核音色" description="有新的公开申请时会出现在这里." />
        ) : null}
        <div className="my-voice-list">
          {rows.map((speaker) => (
            <article key={speaker.id} className="my-voice-row">
              <Avatar
                name={speaker.name ?? `音色 ${speaker.id}`}
                url={speaker.icon_url}
                id={speaker.id}
              />
              <div className="my-voice-info">
                <strong>{speaker.name ?? `音色 ${speaker.id}`}</strong>
                <span>{speaker.description || '—'}</span>
                <span className="muted small">创建者 {speaker.owner_username ?? '未知'}</span>
              </div>
              <div className="my-voice-actions">
                {speaker.audio_url && (
                  <audio controls preload="none" src={speaker.audio_url} aria-label="试听参考音频" />
                )}
                {rejecting === speaker.id ? (
                  <form
                    className="reject-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const id = speaker.id
                      setRejecting(null)
                      void run(
                        () => reviewSpeaker(id, 'reject', comment.trim() || undefined),
                        `已驳回音色 "${speaker.name}".`,
                      )
                    }}
                  >
                    <label>
                      驳回原因 (可选)
                      <input
                        value={comment}
                        maxLength={500}
                        disabled={action.busy}
                        onChange={(event) => setComment(event.target.value)}
                      />
                    </label>
                    <div className="button-row">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={action.busy}
                        onClick={() => setRejecting(null)}
                      >
                        取消
                      </button>
                      <button className="button primary" disabled={action.busy}>
                        确认驳回
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="button-row">
                    <button
                      className="button primary"
                      disabled={action.busy}
                      onClick={() =>
                        void run(
                          () => reviewSpeaker(speaker.id, 'approve'),
                          `已通过音色 "${speaker.name}", 现已在广场展示.`,
                        )
                      }
                    >
                      通过
                    </button>
                    <button
                      className="button secondary danger-text"
                      disabled={action.busy}
                      onClick={() => {
                        setRejecting(speaker.id)
                        setComment('')
                      }}
                    >
                      驳回
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
        <ErrorNotice message={action.error} />
        {notice && (
          <p className="notice success" role="status">
            {notice}
          </p>
        )}
      </section>
    </>
  )
}
