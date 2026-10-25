import { useState, type FormEvent } from 'react'
import { createApiKey, listApiKeys, revokeApiKey } from '../api/auth'
import type { ApiKey, CreatedApiKey } from '../api/types'
import { useAction } from '../hooks/useAction'
import { useQuery } from '../hooks/useQuery'
import { ConfirmDialog } from './ConfirmDialog'
import { ErrorNotice } from './Feedback'

const expiryOptions = [
  ['30', '30 天'],
  ['90', '90 天'],
  ['365', '1 年'],
  ['', '永不过期'],
] as const

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

function isExpired(key: ApiKey) {
  return key.expires_at !== null && Date.parse(key.expires_at) <= Date.now()
}

export function ApiKeyPanel() {
  const query = useQuery(listApiKeys)
  const create = useAction()
  const revoke = useAction()
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('90')
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [notice, setNotice] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    void create.run(async () => {
      if (!name.trim()) throw new Error('请输入 Key 名称.')
      setNotice('')
      setCreated(null)
      setCopyStatus('')
      setCreated(
        await createApiKey(name.trim(), expiry ? Number(expiry) : null),
      )
      setName('')
      query.reload()
    })
  }
  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(key)
      setCopyStatus('已复制到剪贴板.')
    } catch {
      setCopyStatus('无法访问剪贴板, 请手动选中复制.')
    }
  }
  function confirmRevoke() {
    if (!revoking) return
    void revoke.run(async () => {
      await revokeApiKey(revoking.id)
      if (created?.id === revoking.id) setCreated(null)
      setNotice(`API Key "${revoking.name}" 已撤销.`)
      setRevoking(null)
      query.reload()
    })
  }
  return (
    <section className="panel api-key-panel" aria-labelledby="api-key-title">
      <h2 id="api-key-title">API Key</h2>
      <p className="muted">
        在脚本或其他服务中直接调用 ZVox 接口时, 通过请求头{' '}
        <code>Authorization: Bearer &lt;API Key&gt;</code> 认证. API Key
        拥有与你账号相同的权限, 但不能管理 API Key 或修改密码, 请妥善保管.
      </p>
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {created && (
        <div className="notice success api-key-created">
          <p>
            API Key "{created.name}" 已创建. 请立即复制并妥善保存,
            离开此页面后将无法再次查看.
          </p>
          <input
            readOnly
            aria-label="新的 API Key"
            value={created.key}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              onClick={() => void copy(created.key)}
            >
              复制
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setCreated(null)}
            >
              我已保存
            </button>
            {copyStatus && <span role="status">{copyStatus}</span>}
          </div>
        </div>
      )}
      <form className="api-key-form" onSubmit={submit}>
        <label>
          Key 名称
          <input
            required
            maxLength={64}
            autoComplete="off"
            placeholder="例如: 批量生成脚本"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          有效期
          <select
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          >
            {expiryOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" disabled={create.busy}>
          {create.busy ? '正在创建...' : '创建 Key'}
        </button>
      </form>
      <ErrorNotice message={create.error} />
      <ErrorNotice message={query.error} retry={query.reload} />
      {query.data?.length === 0 && (
        <p className="muted small">还没有 API Key.</p>
      )}
      <div className="api-key-list">
        {query.data?.map((key) => {
          const expired = isExpired(key)
          return (
            <article className="api-key-row" key={key.id}>
              <div className="api-key-name">
                <strong>{key.name}</strong>
                <code>{key.prefix}…</code>
              </div>
              <dl>
                <dt>创建时间</dt>
                <dd>{formatTime(key.created_at)}</dd>
                <dt>最近使用</dt>
                <dd>
                  {key.last_used_at ? formatTime(key.last_used_at) : '从未使用'}
                </dd>
                <dt>过期时间</dt>
                <dd className={expired ? 'danger-text' : undefined}>
                  {expired
                    ? '已过期'
                    : key.expires_at
                      ? formatTime(key.expires_at)
                      : '永不过期'}
                </dd>
              </dl>
              <button
                className="text-button danger-text"
                onClick={() => {
                  revoke.clearError()
                  setRevoking(key)
                }}
              >
                撤销
              </button>
            </article>
          )
        })}
      </div>
      {revoking && (
        <ConfirmDialog
          title={`撤销 API Key: ${revoking.name}`}
          busy={revoke.busy}
          onClose={() => setRevoking(null)}
          onConfirm={confirmRevoke}
        >
          <p>撤销后, 使用此 Key 的请求将立即失败. 此操作无法恢复.</p>
          <ErrorNotice message={revoke.error} />
        </ConfirmDialog>
      )}
    </section>
  )
}
