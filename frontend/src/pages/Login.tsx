import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { login } from '../api/auth'
import { useAuth } from '../auth/context'
import { ErrorNotice } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { useAction } from '../hooks/useAction'

export function Login() {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const action = useAction()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const from: unknown = location.state?.from
  const target =
    typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    !from.includes('\\') &&
    !from.startsWith('/login')
      ? from
      : '/'
  if (auth.user && !auth.loading) return <Navigate to={target} replace />
  function submit(event: FormEvent) {
    event.preventDefault()
    void action.run(async () => {
      auth.accept(await login(username, password))
      setPassword('')
      navigate(target, { replace: true })
    })
  }
  return (
    <main className="auth-page">
      <div className="login-layout">
        <div className="login-story">
          <p className="eyebrow">A SPACE FOR YOUR VOICE</p>
          <h1>
            每一段文字,
            <br />
            都值得被听见.
          </h1>
          <p>
            从一个想法, 到一段鲜活的声音.
            <br />
            登录 ZVox, 开始你的下一次创作.
          </p>
          <div className="wave-art" aria-hidden="true">
            {Array.from({ length: 31 }, (_, index) => (
              <i
                key={index}
                style={{
                  height: `${16 + Math.sin(index * 0.8) ** 2 * (90 - Math.abs(index - 15) * 4)}%`,
                }}
              />
            ))}
          </div>
          <span className="story-caption">WORDS INTO VOICE.</span>
        </div>
        <section className="panel login-panel">
          <div className="brand-mark">
            <Icon name="studio" />
          </div>
          <h2>欢迎回来</h2>
          <p className="muted">登录你的账号, 继续创作.</p>
          {auth.notice && (
            <p className="notice" role="status">
              {auth.notice}
            </p>
          )}
          <form onSubmit={submit} className="form-stack">
            <label>
              用户名
              <input
                autoComplete="username"
                required
                maxLength={32}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="输入用户名"
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入密码"
              />
            </label>
            <ErrorNotice message={action.error} />
            <button
              className="button primary full-width"
              disabled={action.busy}
            >
              {action.busy ? '正在登录...' : '登录'}
              <Icon name="arrow" />
            </button>
          </form>
          <p className="small muted login-help">还没有账号? 请联系管理员创建.</p>
        </section>
      </div>
    </main>
  )
}
