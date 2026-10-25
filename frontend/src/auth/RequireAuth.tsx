import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './context'
import { EmptyState, ErrorNotice } from '../components/Feedback'

export function RequireAuth({ admin = false }: { admin?: boolean }) {
  const auth = useAuth()
  const location = useLocation()
  // 刚登录时已有用户信息, 不等待后台的会话校验.
  if (auth.loading && !auth.user)
    return (
      <main className="auth-page">
        <EmptyState title="正在恢复登录状态" description="请稍候." />
      </main>
    )
  if (auth.error)
    return (
      <main className="auth-page">
        <ErrorNotice
          message={auth.error}
          retry={() => {
            void auth.refresh()
          }}
        />
      </main>
    )
  if (!auth.user)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    )
  if (admin && auth.user.role !== 'admin')
    return <EmptyState title="无权访问" description="此页面仅对管理员开放." />
  return <Outlet key={auth.user.id} />
}
