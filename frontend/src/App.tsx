import { useState } from 'react'
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router'
import { logout } from './api/auth'
import { ApiError } from './api/client'
import { useAuth } from './auth/context'
import { RequireAuth } from './auth/RequireAuth'
import { Avatar } from './components/Avatar'
import { EmptyState } from './components/Feedback'
import { Icon } from './components/Icon'
import { Account } from './pages/Account'
import { AdminReviews } from './pages/AdminReviews'
import { AdminSystem } from './pages/AdminSystem'
import { AdminUsers } from './pages/AdminUsers'
import { ApiDocs } from './pages/ApiDocs'
import { JobDetail } from './pages/JobDetail'
import { Jobs } from './pages/Jobs'
import { Login } from './pages/Login'
import { MySpeakers } from './pages/MySpeakers'
import { Plaza } from './pages/Plaza'
import { Studio } from './pages/Studio'

function pageName(pathname: string, isAdmin: boolean) {
  if (pathname === '/') return '语音工作台'
  if (pathname === '/plaza') return '音色广场'
  if (pathname === '/speakers') return '我的音色'
  if (pathname === '/jobs') return isAdmin ? '全部作品' : '我的作品'
  if (pathname.startsWith('/jobs/')) return '作品详情'
  if (pathname === '/account') return '账号设置'
  if (pathname === '/docs') return 'API 文档'
  if (pathname === '/admin/users') return '用户管理'
  if (pathname === '/admin/reviews') return '音色审核'
  if (pathname === '/admin/system') return '系统管理'
  return '声音创作空间'
}

function Layout() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [loggingOut, setLoggingOut] = useState(false)
  async function signOut() {
    if (loggingOut) return
    setLoggingOut(true)
    let notice = '你已退出登录.'
    try {
      await logout()
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401))
        notice = '已清理本机登录信息, 但服务端会话撤销失败. 原会话可能仍有效.'
    } finally {
      auth.clear(notice)
      setLoggingOut(false)
      navigate('/login')
    }
  }
  return (
    <div className="app-layout">
      <a href="#main" className="skip-link">
        跳转到主要内容
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Icon name="studio" />
          </span>
          ZVox<span className="brand-sub">STUDIO</span>
        </Link>
        <nav aria-label="主导航">
          <p className="nav-heading">工作空间</p>
          <NavLink to="/" end>
            <Icon name="studio" />
            语音工作台
          </NavLink>
          <NavLink to="/plaza">
            <Icon name="plaza" />
            音色广场
          </NavLink>
          <NavLink to="/speakers">
            <Icon name="voice" />
            我的音色
          </NavLink>
          <NavLink to="/jobs">
            <Icon name="jobs" />
            {auth.user?.role === 'admin' ? '全部作品' : '我的作品'}
          </NavLink>
          <NavLink to="/account">
            <Icon name="user" />
            账号设置
          </NavLink>
          <NavLink to="/docs">
            <Icon name="docs" />
            API 文档
          </NavLink>
          {auth.user?.role === 'admin' && (
            <>
              <p className="nav-heading admin-label">管理</p>
              <NavLink to="/admin/users">
                <Icon name="user" />
                用户管理
              </NavLink>
              <NavLink to="/admin/reviews">
                <Icon name="voice" />
                音色审核
              </NavLink>
              <NavLink to="/admin/system">
                <Icon name="settings" />
                系统管理
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="studio" />
            <p>
              灵感有声.
              <br />
              <span>让每个想法被听见.</span>
            </p>
          </div>
          {auth.user && (
            <div className="sidebar-account">
              <Link to="/account">
                <Avatar name={auth.user.username} id={auth.user.id} />
                <span>
                  <strong>{auth.user.username}</strong>
                  <small>
                    {auth.user.role === 'admin' ? '管理员' : '创作者'}
                  </small>
                </span>
              </Link>
              <button
                className="text-button"
                disabled={loggingOut}
                onClick={() => {
                  void signOut()
                }}
              >
                {loggingOut ? '退出中' : '退出'}
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span aria-current="page">
            ZVox <span className="breadcrumb-divider">/</span>{' '}
            {pageName(pathname, auth.user?.role === 'admin')}
          </span>
          <span className="topbar-caption">CREATE SOMETHING WORTH HEARING</span>
        </header>
        <main id="main" className="main-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>ZVox Studio</span>
          <span>把想法写下来, 让声音走出去.</span>
        </footer>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Studio />} />
          <Route path="plaza" element={<Plaza />} />
          <Route path="speakers" element={<MySpeakers />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="account" element={<Account />} />
          <Route path="docs" element={<ApiDocs />} />
          <Route element={<RequireAuth admin />}>
            <Route path="admin/users" element={<AdminUsers />} />
            <Route path="admin/reviews" element={<AdminReviews />} />
            <Route path="admin/system" element={<AdminSystem />} />
          </Route>
          <Route
            path="*"
            element={
              <EmptyState
                title="页面不存在"
                description="回到工作台, 继续你的创作."
              >
                <Link to="/" className="button primary">
                  返回工作台
                </Link>
              </EmptyState>
            }
          />
        </Route>
      </Route>
    </Routes>
  )
}
