import { useState } from 'react'
import {
  getModelStatus,
  getSyncStatus,
  startModel,
  startSync,
} from '../api/admin'
import type { ModelStatus, SyncStatus } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorNotice, PageHeading } from '../components/Feedback'
import { useAction } from '../hooks/useAction'
import { useQuery } from '../hooks/useQuery'

const pollSync = (data: SyncStatus) => (data.running ? 2000 : 0)
const pollModel = (data: ModelStatus) =>
  'downloading' in data && data.downloading ? 2000 : 0

export function AdminSystem() {
  const sync = useQuery(getSyncStatus, pollSync)
  const model = useQuery(getModelStatus, pollModel)
  const syncAction = useAction()
  const modelAction = useAction()
  const [confirmSync, setConfirmSync] = useState(false)
  const [syncNotice, setSyncNotice] = useState('')
  const [modelNotice, setModelNotice] = useState('')
  const downloading =
    !!model.data && 'downloading' in model.data && model.data.downloading
  const ready =
    !!model.data && 'status' in model.data && model.data.status === 'ready'
  const modelError =
    model.data && 'error' in model.data ? model.data.error : null
  const modelLabel = model.loading
    ? '正在检查'
    : model.error
      ? '状态未知'
      : ready
        ? '已就绪'
        : downloading
          ? '下载中'
          : modelError
            ? '下载失败'
            : '未就绪'
  function importSpeakers() {
    void syncAction.run(async () => {
      const result = await startSync()
      setSyncNotice(
        result.status === 'already_running'
          ? '已有导入正在进行, 正在获取状态.'
          : '已提交导入, 正在获取状态.',
      )
      setConfirmSync(false)
      sync.reload()
    })
  }
  function downloadModel() {
    void modelAction.run(async () => {
      const result = await startModel()
      setModelNotice(
        result.status === 'ready'
          ? '模型已就绪.'
          : result.status === 'downloading'
            ? '模型正在下载.'
            : '已开始下载模型.',
      )
      model.reload()
    })
  }
  return (
    <>
      <PageHeading
        eyebrow="SYSTEM SETTINGS"
        title="系统管理"
        description="准备好音色与模型, 让创作顺畅发生."
      />
      <div className="settings-grid">
        <section className="panel">
          <div className="section-title">
            <h2>音色资源</h2>
            <span className="badge">
              {sync.loading
                ? '正在检查'
                : sync.error
                  ? '状态未知'
                  : sync.data?.running
                    ? '导入中'
                    : '空闲'}
            </span>
          </div>
          <p className="muted">
            从已发布的资源中导入音色, 更新工作台的音色列表.
          </p>
          <div className="system-illustration" aria-hidden="true">
            <div className="resource-block">VOICE</div>
            <span>→</span>
            <div className="resource-block accent">ZVox</div>
          </div>
          <ErrorNotice message={sync.error} retry={sync.reload} />
          {syncNotice && (
            <p className="small muted" role="status">
              {syncNotice}
            </p>
          )}
          <div className="button-row">
            <button
              className="button primary"
              disabled={
                syncAction.busy ||
                sync.loading ||
                !sync.data ||
                sync.data.running
              }
              onClick={() => {
                syncAction.clearError()
                setConfirmSync(true)
              }}
            >
              {sync.data?.running ? '正在导入...' : '导入音色'}
            </button>
            <button className="button secondary" onClick={sync.reload}>
              刷新状态
            </button>
          </div>
          {sync.data?.last_result && (
            <div className="sync-result">
              <h3>最近一次导入</h3>
              <div className="result-counts">
                <div>
                  <strong>{sync.data.last_result.imported}</strong>
                  <span>导入音色</span>
                </div>
                <div>
                  <strong>{sync.data.last_result.deleted}</strong>
                  <span>移除索引</span>
                </div>
                <div>
                  <strong>{sync.data.last_result.errors.length}</strong>
                  <span>错误</span>
                </div>
              </div>
              {sync.data.last_result.errors.length ? (
                <ul className="error-list">
                  {sync.data.last_result.errors.map((error, index) => (
                    <li key={index}>
                      {error.key && <code>{error.key}: </code>}
                      {error.error}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small success-text">导入已完成.</p>
              )}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="section-title">
            <h2>语音模型</h2>
            <span
              className={`badge ${ready ? 'completed' : downloading ? 'running' : ''}`}
            >
              {modelLabel}
            </span>
          </div>
          <p className="muted">
            VoxCPM2 为语音生成提供支持. 首次使用前, 请确保模型已就绪.
          </p>
          <div className="model-card">
            <span className="model-monogram">V</span>
            <div>
              <strong>VoxCPM2</strong>
              <span>VOICE GENERATION MODEL</span>
            </div>
          </div>
          <ErrorNotice
            message={model.error || modelError || modelAction.error}
            retry={model.reload}
          />
          {modelNotice && (
            <p className="small muted" role="status">
              {modelNotice}
            </p>
          )}
          <div className="button-row">
            <button
              className="button primary"
              disabled={modelAction.busy || model.loading || downloading}
              onClick={downloadModel}
            >
              {modelAction.busy
                ? '正在请求...'
                : downloading
                  ? '正在下载...'
                  : ready
                    ? '检查模型'
                    : '检查并下载'}
            </button>
            <button className="button secondary" onClick={model.reload}>
              刷新状态
            </button>
          </div>
          <p className="panel-footnote">
            下载可能需要一些时间, 可以离开此页面稍后查看.
          </p>
        </section>
      </div>
      {confirmSync && (
        <ConfirmDialog
          title="导入音色资源"
          busy={syncAction.busy}
          onClose={() => setConfirmSync(false)}
          onConfirm={importSpeakers}
        >
          <p>
            导入会更新音色索引, 并移除已从 S3 撤下的音色. 请确认资源已发布完整.
          </p>
          <ErrorNotice message={syncAction.error} />
        </ConfirmDialog>
      )}
    </>
  )
}
