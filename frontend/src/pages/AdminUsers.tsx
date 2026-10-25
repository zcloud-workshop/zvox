import { useState, type FormEvent } from 'react'
import { createUser, listUsers, resetPassword, updateUser } from '../api/admin'
import type { Role, User } from '../api/types'
import { useAuth } from '../auth/context'
import { Avatar } from '../components/Avatar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, ErrorNotice, PageHeading } from '../components/Feedback'
import { useAction } from '../hooks/useAction'
import { useQuery } from '../hooks/useQuery'

interface Edit {
  user: User
  kind: 'role' | 'active' | 'password'
}
export function AdminUsers() {
  const auth = useAuth()
  const query = useQuery(listUsers)
  const create = useAction()
  const editAction = useAction()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [edit, setEdit] = useState<Edit | null>(null)
  const [reset, setReset] = useState('')
  const [notice, setNotice] = useState('')
  function openEdit(user: User, kind: Edit['kind']) {
    editAction.clearError()
    setReset('')
    setEdit({ user, kind })
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void create.run(async () => {
      setNotice('')
      await createUser(username, password, role)
      setUsername('')
      setPassword('')
      setRole('user')
      setNotice('用户已创建.')
      query.reload()
    })
  }
  function confirm() {
    if (!edit) return
    void editAction.run(async () => {
      if (edit.kind === 'password') await resetPassword(edit.user.id, reset)
      else
        await updateUser(
          edit.user.id,
          edit.kind === 'role'
            ? { role: edit.user.role === 'admin' ? 'user' : 'admin' }
            : { is_active: !edit.user.is_active },
        )
      setEdit(null)
      setReset('')
      setNotice('用户设置已更新.')
      query.reload()
      if (edit.user.id === auth.user?.id) {
        if (edit.kind === 'password') auth.clear('密码已重置, 请重新登录.')
        else await auth.refresh()
      }
    })
  }
  const editTitle =
    edit?.kind === 'password'
      ? '重置密码'
      : edit?.kind === 'role'
        ? '修改角色'
        : edit?.user.is_active
          ? '停用用户'
          : '启用用户'
  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRATION"
        title="用户管理"
        description="管理团队成员及其访问权限."
      />
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      <ErrorNotice message={query.error} retry={query.reload} />
      <div className="users-grid">
        <section className="panel">
          <div className="section-title">
            <h2>用户列表</h2>
            <button className="text-button" onClick={query.reload}>
              刷新
            </button>
          </div>
          {query.loading && (
            <EmptyState title="正在加载用户" description="请稍候." />
          )}
          {query.data?.length === 0 && (
            <EmptyState title="暂无用户" description="在右侧创建一个账号." />
          )}
          <div className="user-list">
            {query.data?.map((user) => (
              <article className="user-row" key={user.id}>
                <div className="user-identity">
                  <Avatar name={user.username} id={user.id} />
                  <div>
                    <strong>
                      {user.username}
                      {user.id === auth.user?.id && (
                        <span className="small muted"> (你)</span>
                      )}
                    </strong>
                    <span className="small muted">
                      {user.role === 'admin' ? '管理员' : '普通用户'} /{' '}
                      {user.is_active ? '已启用' : '已停用'}
                    </span>
                  </div>
                </div>
                <div className="user-actions">
                  <button
                    className="text-button"
                    onClick={() => openEdit(user, 'role')}
                  >
                    修改角色
                  </button>
                  <button
                    className="text-button"
                    onClick={() => openEdit(user, 'password')}
                  >
                    重置密码
                  </button>
                  <button
                    className={`text-button ${user.is_active ? 'danger-text' : ''}`}
                    onClick={() => openEdit(user, 'active')}
                  >
                    {user.is_active ? '停用' : '启用'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>创建用户</h2>
          <p className="muted small">为新的创作者开启声音之旅.</p>
          <form className="form-stack" onSubmit={submit}>
            <label>
              用户名
              <input
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_.\-]+"
                autoComplete="off"
                title="3-32 位字母, 数字, 点, 下划线或连字符"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <p className="field-hint">3-32 位字母, 数字, 点, 下划线或连字符.</p>
            <label>
              初始密码
              <input
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <p className="field-hint">使用 8-128 个字符.</p>
            <label>
              角色
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            {role === 'admin' && (
              <p className="notice">管理员可查看全部任务和管理所有用户.</p>
            )}
            <ErrorNotice message={create.error} />
            <button className="button primary" disabled={create.busy}>
              {create.busy ? '正在创建...' : '创建用户'}
            </button>
          </form>
        </section>
      </div>
      {edit && (
        <ConfirmDialog
          title={`${editTitle}: ${edit.user.username}`}
          busy={editAction.busy}
          onClose={() => {
            setEdit(null)
            setReset('')
          }}
          onConfirm={confirm}
        >
          {edit.kind === 'password' ? (
            <>
              <p>
                旧密码, 所有登录会话和 API Key 将失效. 请将新密码交给此用户.
              </p>
              <label>
                新密码
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={reset}
                  onChange={(event) => setReset(event.target.value)}
                />
              </label>
              <p className="field-hint">使用 8-128 个字符.</p>
            </>
          ) : edit.kind === 'role' ? (
            <p>
              将此用户改为
              {edit.user.role === 'admin'
                ? '普通用户, 管理权限将被移除.'
                : '管理员, 可查看全部任务并管理用户和系统.'}{' '}
              此用户需要重新登录, 已创建的 API Key 将失效.
            </p>
          ) : (
            <p>
              {edit.user.is_active
                ? '停用后此用户将立即失去访问权限, API Key 将被撤销, 历史任务会保留.'
                : '启用后此用户可以重新登录使用 ZVox.'}
            </p>
          )}
          <ErrorNotice message={editAction.error} />
        </ConfirmDialog>
      )}
    </>
  )
}
