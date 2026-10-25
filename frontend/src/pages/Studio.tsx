import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { listSpeakers } from '../api/speakers'
import { createJob } from '../api/jobs'
import { useAuth } from '../auth/context'
import { Avatar } from '../components/Avatar'
import { EmptyState, ErrorNotice, PageHeading } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { useAction } from '../hooks/useAction'
import { useQuery } from '../hooks/useQuery'

export function Studio() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const speakers = useQuery(listSpeakers)
  const action = useAction()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [text, setText] = useState('')
  const selected = speakers.data?.find((speaker) => speaker.id === selectedId)
  const visible =
    speakers.data?.filter((speaker) =>
      (speaker.name ?? `音色 ${speaker.id}`)
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? []
  const count = Array.from(text).length
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!selected || !text.trim() || count > 4096) return
    void action.run(async () => {
      const result = await createJob(selected.id, text)
      navigate(`/jobs/${result.job_id}`)
    })
  }
  return (
    <>
      <PageHeading
        eyebrow="VOICE STUDIO"
        title="让文字, 拥有声音."
        description="选择一个声音, 写下你的想法. 余下的交给 ZVox."
      >
        <span className="heading-label">
          <span className="status-dot" /> 语音创作工作台
        </span>
      </PageHeading>
      <div className="studio-grid">
        <section className="panel voice-panel" aria-labelledby="voices-title">
          <div className="section-title">
            <div>
              <span className="step">01</span>
              <h2 id="voices-title">选择音色</h2>
            </div>
            <span className="count-tag">
              {speakers.data?.length ?? 0} 个音色
            </span>
          </div>
          <div className="search-input">
            <Icon name="search" />
            <input
              aria-label="搜索音色"
              placeholder="搜索音色名称"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <ErrorNotice message={speakers.error} retry={speakers.reload} />
          {speakers.loading ? (
            <EmptyState title="正在加载音色" description="马上就好." />
          ) : !speakers.error && visible.length === 0 ? (
            <EmptyState
              title={search ? '没有匹配的音色' : '声音即将登场'}
              description={
                search
                  ? '试试其他名称.'
                  : '管理员导入音色后, 就能在这里开始创作.'
              }
            />
          ) : null}
          <div className="voice-list">
            {visible.map((speaker) => (
              <button
                key={speaker.id}
                className={`voice-card ${selectedId === speaker.id ? 'selected' : ''}`}
                aria-pressed={selectedId === speaker.id}
                onClick={() => setSelectedId(speaker.id)}
              >
                <Avatar
                  name={speaker.name ?? `音色 ${speaker.id}`}
                  url={speaker.icon_url}
                  id={speaker.id}
                />
                <span className="voice-info">
                  <strong>{speaker.name ?? `音色 ${speaker.id}`}</strong>
                  <span>
                    {speaker.description || '等待你的文字, 开启新的表达.'}
                  </span>
                </span>
                <span className="selection-indicator" aria-hidden="true" />
              </button>
            ))}
          </div>
          {user?.role === 'admin' && (
            <Link className="button secondary" to="/admin/system">添加音频</Link>
          )}
          <p className="panel-footnote">每一种声音, 都有自己的表达.</p>
        </section>
        <form className="panel editor-panel" onSubmit={submit}>
          <div className="section-title">
            <div>
              <span className="step">02</span>
              <h2>创作文本</h2>
            </div>
            <span className="subtle-label">TEXT TO SPEECH</span>
          </div>
          <div className="selected-voice">
            {selected ? (
              <>
                <Avatar
                  name={selected.name ?? '音色'}
                  url={selected.icon_url}
                  id={selected.id}
                />
                <div>
                  <span className="muted small">当前音色</span>
                  <strong>{selected.name ?? `音色 ${selected.id}`}</strong>
                </div>
                <span className="selected-label">已选择</span>
              </>
            ) : (
              <>
                <span className="voice-placeholder">
                  <Icon name="studio" />
                </span>
                <div>
                  <strong>寻找适合你的声音</strong>
                  <span className="muted small">从音色列表中选择一个音色</span>
                </div>
              </>
            )}
          </div>
          <label className="sr-only" htmlFor="script">
            创作文本
          </label>
          <textarea
            id="script"
            className="script-input"
            placeholder="在这里写下想说的话..."
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-describedby="text-count"
            aria-invalid={count > 4096}
          />
          <div className="editor-meta">
            <span>自然的标点, 让表达更流畅.</span>
            <span id="text-count" className={count > 4096 ? 'danger-text' : ''}>
              {count.toLocaleString()} / 4,096
            </span>
          </div>
          <ErrorNotice message={action.error} />
          <div className="editor-footer">
            <div className="generation-note">
              <Icon name="studio" />
              <span>
                由文字出发
                <br />
                <strong>生成属于你的声音</strong>
              </span>
            </div>
            <button
              className="button primary"
              disabled={
                action.busy || !selected || !text.trim() || count > 4096
              }
            >
              {action.busy ? '正在提交...' : '生成语音'}
              <Icon name="arrow" />
            </button>
          </div>
        </form>
      </div>
      <div className="studio-notes">
        <span>
          <b>01</b> 选择音色
        </span>
        <i />
        <span>
          <b>02</b> 写下文字
        </span>
        <i />
        <span>
          <b>03</b> 听见灵感
        </span>
      </div>
    </>
  )
}
