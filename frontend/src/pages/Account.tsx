import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { changePassword } from '../api/auth'
import { useAuth } from '../auth/context'
import { ApiKeyPanel } from '../components/ApiKeyPanel'
import { ErrorNotice, PageHeading } from '../components/Feedback'
import { useAction } from '../hooks/useAction'

export function Account() {
  const auth = useAuth()
  const navigate = useNavigate()
  const action = useAction()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    void action.run(async () => {
      if (password !== confirm) throw new Error('两次输入的新密码不一致.')
      await changePassword(current, password)
      auth.clear('密码已修改, 请使用新密码重新登录.')
      navigate('/login', { replace: true })
    })
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR ACCOUNT"
        title="账号设置"
        description="管理你的账号, 登录密码与 API Key."
      />
      <div className="settings-grid">
        <section className="panel profile-panel">
          <h2>个人信息</h2>
          <dl className="account-info">
            <dt>用户名</dt>
            <dd>{auth.user?.username}</dd>
            <dt>账号角色</dt>
            <dd>{auth.user?.role === 'admin' ? '管理员' : '普通用户'}</dd>
            <dt>创建时间</dt>
            <dd>
              {auth.user &&
                new Date(auth.user.created_at).toLocaleDateString('zh-CN')}
            </dd>
          </dl>
        </section>
        <section className="panel password-panel">
          <h2>修改密码</h2>
          <p className="muted">
            修改后, 所有设备都需要重新登录, 已创建的 API Key 也会失效.
          </p>
          <form className="form-stack" onSubmit={submit}>
            <label>
              当前密码
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="password-hint"
              />
            </label>
            <p className="field-hint" id="password-hint">
              使用 8-128 个字符.
            </p>
            <label>
              确认新密码
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </label>
            <ErrorNotice message={action.error} />
            <button className="button primary" disabled={action.busy}>
              {action.busy ? '正在保存...' : '保存新密码'}
            </button>
          </form>
        </section>
        <ApiKeyPanel />
      </div>
    </>
  )
}
