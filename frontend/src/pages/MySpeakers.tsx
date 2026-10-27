import { useState } from 'react'
import { listMySpeakers, submitSpeaker, withdrawSpeaker } from '../api/speakers'
import { Avatar } from '../components/Avatar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, ErrorNotice, PageHeading } from '../components/Feedback'
import { SpeakerStatusBadge } from '../components/SpeakerStatusBadge'
import { SpeakerUpload } from '../components/SpeakerUpload'
import { useAction } from '../hooks/useAction'
import { useQuery } from '../hooks/useQuery'

export function MySpeakers() {
  const mine = useQuery(listMySpeakers)
  const action = useAction()
  const [removing, setRemoving] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const rows = mine.data ?? []

  async function run(next: () => Promise<unknown>, message: string) {
    await action.run(async () => {
      setNotice('')
      await next()
      setNotice(message)
      mine.reload()
    })
  }

  return (
    <>
      <PageHeading
        eyebrow="MY VOICES"
        title="我的音色."
        description="上传或录制参考音频创建专属音色; 音色默认私有, 可申请公开到音色广场."
      >
        <span className="heading-label">
          <span className="status-dot" /> 已创建 {rows.length} 个音色
        </span>
      </PageHeading>
      <div className="my-speakers-grid">
        <SpeakerUpload variant="personal" />
        <section className="panel" aria-labelledby="my-voices-title">
          <div className="section-title">
            <div>
              <span className="step">02</span>
              <h2 id="my-voices-title">音色管理</h2>
            </div>
            <span className="count-tag">{rows.length} 个</span>
          </div>
          <ErrorNotice message={mine.error} retry={mine.reload} />
          {mine.loading ? (
            <EmptyState title="正在加载" description="马上就好." />
          ) : !mine.error && rows.length === 0 ? (
            <EmptyState
              title="还没有创建音色"
              description="在左侧上传或录制参考音频, 创建你的第一个音色."
            />
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
                  <span>{speaker.description || '等待你的文字, 开启新的表达.'}</span>
                  {speaker.status === 'rejected' && speaker.review_comment && (
                    <span className="review-comment">审核意见: {speaker.review_comment}</span>
                  )}
                </div>
                <div className="my-voice-actions">
                  <SpeakerStatusBadge status={speaker.status ?? 'private'} />
                  {speaker.audio_url && (
                    <audio controls preload="none" src={speaker.audio_url} aria-label="试听参考音频" />
                  )}
                  {speaker.status === 'private' && (
                    <button
                      className="button secondary"
                      disabled={action.busy}
                      onClick={() =>
                        void run(
                          () => submitSpeaker(speaker.id),
                          `音色 "${speaker.name}" 已提交管理员审核.`,
                        )
                      }
                    >
                      申请公开
                    </button>
                  )}
                  {speaker.status === 'rejected' && (
                    <button
                      className="button secondary"
                      disabled={action.busy}
                      onClick={() =>
                        void run(
                          () => submitSpeaker(speaker.id),
                          `音色 "${speaker.name}" 已重新提交审核.`,
                        )
                      }
                    >
                      重新提交
                    </button>
                  )}
                  {speaker.status === 'pending' && (
                    <button
                      className="button secondary danger-text"
                      disabled={action.busy}
                      onClick={() =>
                        void run(() => withdrawSpeaker(speaker.id), '已撤回公开申请.')
                      }
                    >
                      撤回审核
                    </button>
                  )}
                  {speaker.status === 'approved' && (
                    <button
                      className="button secondary danger-text"
                      disabled={action.busy}
                      onClick={() => setRemoving(speaker.id)}
                    >
                      下架广场
                    </button>
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
      </div>
      {removing !== null && (
        <ConfirmDialog
          title="确认下架"
          busy={action.busy}
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing
            setRemoving(null)
            void run(() => withdrawSpeaker(id), '音色已下架, 回到私有状态.')
          }}
        >
          下架后该音色将立即从音色广场移除, 其他用户不能再使用; 你仍可随时重新申请公开.
        </ConfirmDialog>
      )}
    </>
  )
}
