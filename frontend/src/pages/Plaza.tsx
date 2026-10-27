import { useState } from 'react'
import { useNavigate } from 'react-router'
import { listPlazaSpeakers } from '../api/speakers'
import { Avatar } from '../components/Avatar'
import { EmptyState, ErrorNotice, PageHeading } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { useQuery } from '../hooks/useQuery'

export function Plaza() {
  const navigate = useNavigate()
  const speakers = useQuery(listPlazaSpeakers)
  const [search, setSearch] = useState('')
  const visible =
    speakers.data?.filter((speaker) =>
      (speaker.name ?? `音色 ${speaker.id}`)
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? []

  return (
    <>
      <PageHeading
        eyebrow="VOICE PLAZA"
        title="音色广场."
        description="浏览系统音色与创作者公开的音色, 试听后一键进入工作台使用."
      >
        <span className="heading-label">
          <span className="status-dot" /> 公开音色 {speakers.data?.length ?? 0} 个
        </span>
      </PageHeading>
      <section className="panel" aria-labelledby="plaza-title">
        <div className="section-title">
          <div>
            <span className="step">01</span>
            <h2 id="plaza-title">公开音色</h2>
          </div>
          <div className="search-input plaza-search">
            <Icon name="search" />
            <input
              aria-label="搜索音色"
              placeholder="搜索音色名称"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <ErrorNotice message={speakers.error} retry={speakers.reload} />
        {speakers.loading ? (
          <EmptyState title="正在加载广场" description="马上就好." />
        ) : !speakers.error && visible.length === 0 ? (
          <EmptyState
            title={search ? '没有匹配的音色' : '广场暂无公开音色'}
            description={
              search
                ? '试试其他名称.'
                : '在「我的音色」中提交公开申请, 管理员审核通过后会在这里展示.'
            }
          />
        ) : null}
        <div className="plaza-grid">
          {visible.map((speaker) => (
            <article key={speaker.id} className="plaza-card">
              <div className="plaza-card-head">
                <Avatar
                  name={speaker.name ?? `音色 ${speaker.id}`}
                  url={speaker.icon_url}
                  id={speaker.id}
                />
                <div className="plaza-card-info">
                  <strong>{speaker.name ?? `音色 ${speaker.id}`}</strong>
                  <span className="muted small">
                    {speaker.owner_id === null ? '系统音色' : `创建者 ${speaker.owner_username ?? '未知'}`}
                  </span>
                </div>
                <span className="count-tag">{speaker.owner_id === null ? '官方' : '公开'}</span>
              </div>
              <p className="plaza-card-desc">
                {speaker.description || '等待你的文字, 开启新的表达.'}
              </p>
              {speaker.audio_url && (
                <audio controls preload="none" src={speaker.audio_url} aria-label="试听参考音频" />
              )}
              <button className="button secondary" onClick={() => navigate(`/?speaker=${speaker.id}`)}>
                使用该音色
                <Icon name="arrow" />
              </button>
            </article>
          ))}
        </div>
        <p className="panel-footnote">每一种被分享的声音, 都在等待更多故事.</p>
      </section>
    </>
  )
}
