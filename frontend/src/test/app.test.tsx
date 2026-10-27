import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { readSession, saveSession } from '../auth/session'
import type { JobListItem, User } from '../api/types'

const user: User = {
  id: 1,
  username: 'creator',
  role: 'user',
  is_active: true,
  created_at: '2026-09-25T10:00:00Z',
}
const session = {
  access_token: 'test-token',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}
const speaker = {
  id: 1,
  name: '清风',
  description: '温暖自然的声音',
  icon_url: null,
}
const job = {
  id: 'job-1',
  status: 'completed',
  text: '你好, 世界.',
  speaker_id: 1,
  speaker_name: '清风',
  speaker_icon_url: null,
  created_at: '2026-09-25T10:00:00Z',
  result_url: 'https://example.invalid/audio.wav',
  started_at: '2026-09-25T10:00:01Z',
  finished_at: '2026-09-25T10:00:03Z',
  duration_seconds: 2,
  error: null,
}
let currentUser = user

function mockApi(
  overrides?: (
    path: string,
    options?: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
    const response = overrides?.(path, options)
    if (response) return response
    if (path === '/api/users/me') return Response.json(currentUser)
    if (path === '/api/users/me/api-keys') return Response.json([])
    if (path === '/api/speakers') return Response.json([speaker])
    if (path === '/api/admin/users' && !options?.method)
      return Response.json([currentUser])
    if (path === '/api/auth/login')
      return Response.json({
        ...session,
        user: currentUser,
        token_type: 'bearer',
      })
    if (path === '/api/jobs' && options?.method === 'POST')
      return Response.json({ job_id: job.id })
    if (path === '/api/jobs/job-1') return Response.json(job)
    if (path.startsWith('/api/jobs?')) return Response.json([])
    if (path === '/api/admin/model/status')
      return Response.json({ status: 'ready', path: './model' })
    if (path === '/api/admin/speakers/sync/status')
      return Response.json({ running: false, last_result: null })
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function mount(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  currentUser = user
})

describe('application flows', () => {
  it('logs in, selects a voice, creates a job, and displays its audio', async () => {
    const fetcher = mockApi()
    const events = userEvent.setup()
    mount('/login')
    await events.type(screen.getByLabelText('用户名'), 'creator')
    await events.type(screen.getByLabelText('密码'), 'test-password-123')
    await events.click(screen.getByRole('button', { name: '登录' }))
    await events.click(await screen.findByRole('button', { name: /清风/ }))
    await events.type(screen.getByLabelText('创作文本'), '你好, 世界.')
    await events.click(await screen.findByRole('button', { name: '生成语音' }))
    expect(await screen.findByText('声音已就绪')).toBeInTheDocument()
    expect(screen.getByLabelText('生成的语音')).toHaveAttribute(
      'src',
      job.result_url,
    )
    const writes = fetcher.mock.calls.filter(
      ([path, options]) => path === '/api/jobs' && options?.method === 'POST',
    )
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0][1]!.body as string)).toEqual({
      speaker_id: 1,
      text: '你好, 世界.',
    })
  })
  it('sends guests to a login page without the sidebar and opens the studio right after login', async () => {
    // 登录后的会话校验一直未返回, 工作台也应直接可用.
    const fetcher = mockApi((path) =>
      path === '/api/users/me' ? new Promise<Response>(() => {}) : undefined,
    )
    const events = userEvent.setup()
    mount()
    expect(
      await screen.findByRole('heading', { name: '欢迎回来' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: '主导航' }),
    ).not.toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
    await events.type(screen.getByLabelText('用户名'), 'creator')
    await events.type(screen.getByLabelText('密码'), 'test-password-123')
    await events.click(screen.getByRole('button', { name: '登录' }))
    expect(
      await screen.findByRole('button', { name: /清风/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: '主导航' }),
    ).toBeInTheDocument()
    const [, options] = fetcher.mock.calls.find(
      ([path]) => path === '/api/speakers',
    )!
    expect(new Headers(options?.headers).get('Authorization')).toBe(
      `Bearer ${session.access_token}`,
    )
  })
  it('validates whitespace and counts Unicode code points at the text limit', async () => {
    saveSession(session)
    mockApi()
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /清风/ }))
    const input = screen.getByLabelText('创作文本')
    const submit = await screen.findByRole('button', { name: '生成语音' })
    fireEvent.change(input, { target: { value: '   ' } })
    expect(submit).toBeDisabled()
    fireEvent.change(input, { target: { value: '\u{20000}'.repeat(4096) } })
    expect(submit).toBeEnabled()
    fireEvent.change(input, { target: { value: '\u{20000}'.repeat(4097) } })
    expect(submit).toBeDisabled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })
  it('retains user input after rate limiting and never retries creation', async () => {
    saveSession(session)
    const fetcher = mockApi((path, options) =>
      path === '/api/jobs' && options?.method === 'POST'
        ? Response.json({ detail: 'Job limit exceeded' }, { status: 429 })
        : undefined,
    )
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /清风/ }))
    fireEvent.change(screen.getByLabelText('创作文本'), {
      target: { value: '保留这段文本' },
    })
    await userEvent.click(
      await screen.findByRole('button', { name: '生成语音' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '任务数量已达限制',
    )
    expect(screen.getByLabelText('创作文本')).toHaveValue('保留这段文本')
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1)
  })
  it('retries a failed job once with its original inputs and follows the new job', async () => {
    saveSession(session)
    let finishRetry!: (response: Response) => void
    const pendingRetry = new Promise<Response>((resolve) => {
      finishRetry = resolve
    })
    const fetcher = mockApi((path, options) => {
      if (path === '/api/jobs/job-1')
        return Response.json({ ...job, status: 'failed', result_url: null, error: 'Model unavailable' })
      if (path === '/api/jobs' && options?.method === 'POST') return pendingRetry
      if (path === '/api/jobs/job-2')
        return Response.json({ ...job, id: 'job-2', status: 'pending', result_url: null })
    })
    mount('/jobs/job-1')
    const retry = await screen.findByRole('button', { name: '重试任务' })
    await userEvent.dblClick(retry)
    expect(screen.getByRole('button', { name: '正在提交...' })).toBeDisabled()
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0][1]!.body as string)).toEqual({
      speaker_id: job.speaker_id,
      text: job.text,
    })
    await act(async () => finishRetry(Response.json({ job_id: 'job-2' })))
    expect(await screen.findByText('job-2')).toBeInTheDocument()
    expect(await screen.findByText('声音正在排队')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试任务' })).not.toBeInTheDocument()
    expect(screen.queryByText('Model unavailable')).not.toBeInTheDocument()
  })
  it.each([404, 429, 500])('keeps a failed job available when retry returns %s', async (status) => {
    saveSession(session)
    const fetcher = mockApi((path, options) => {
      if (path === '/api/jobs/job-1')
        return Response.json({ ...job, status: 'failed', result_url: null, error: 'Model unavailable' })
      if (path === '/api/jobs' && options?.method === 'POST')
        return Response.json({ detail: 'Retry rejected' }, { status })
    })
    mount('/jobs/job-1')
    await userEvent.click(await screen.findByRole('button', { name: '重试任务' }))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getByText('job-1')).toBeInTheDocument()
    expect(screen.getByText(job.text)).toBeInTheDocument()
    expect(screen.getByText('Model unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试任务' })).toBeEnabled()
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })
  it.each(['pending', 'running', 'completed'])('does not offer retry for a %s job', async (status) => {
    saveSession(session)
    mockApi((path) => path === '/api/jobs/job-1' ? Response.json({ ...job, status }) : undefined)
    mount('/jobs/job-1')
    await screen.findByText('job-1')
    expect(screen.queryByRole('button', { name: '重试任务' })).not.toBeInTheDocument()
  })
  it('redirects invalid sessions to login without an error loop', async () => {
    saveSession(session)
    mockApi((path) =>
      path === '/api/users/me'
        ? Response.json({ detail: 'Invalid or expired token' }, { status: 401 })
        : undefined,
    )
    mount('/jobs')
    expect(
      await screen.findByRole('heading', { name: '欢迎回来' }),
    ).toBeInTheDocument()
    expect(readSession()).toBeNull()
  })
  it('denies admin pages for ordinary users', async () => {
    saveSession(session)
    const fetcher = mockApi()
    mount('/admin/system')
    expect(
      await screen.findByRole('heading', { name: '无权访问' }),
    ).toBeInTheDocument()
    expect(
      fetcher.mock.calls.some(([path]) => path.startsWith('/api/admin')),
    ).toBe(false)
  })
  it('reads model status without triggering a download on mount', async () => {
    currentUser = { ...user, role: 'admin' }
    saveSession(session)
    const fetcher = mockApi()
    mount('/admin/system')
    expect(await screen.findByText('已就绪')).toBeInTheDocument()
    expect(
      fetcher.mock.calls.some(([path]) => path === '/api/admin/model'),
    ).toBe(false)
  })
  it('retains loaded history when refreshing the first page', async () => {
    saveSession(session)
    const first: JobListItem[] = Array.from({ length: 20 }, (_, index) => ({
      ...job,
      status: 'completed',
      id: `job-${index}`,
      text: `作品 ${index}`,
      created_at: `2026-09-25T10:00:${String(59 - index).padStart(2, '0')}+00:00`,
    }))
    const fetcher = mockApi((path) =>
      path.startsWith('/api/jobs?')
        ? Response.json(
            path.includes('before=')
              ? [{ ...job, id: 'older', text: '更早的作品' }]
              : first,
          )
        : undefined,
    )
    mount('/jobs')
    await userEvent.click(
      await screen.findByRole('button', { name: '加载更多' }),
    )
    expect(await screen.findByText('更早的作品')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '刷新列表' }))
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([path]) => path.startsWith('/api/jobs?'))
          .length,
      ).toBeGreaterThanOrEqual(4),
    )
    expect(screen.getByText('更早的作品')).toBeInTheDocument()
    const pageRequest = fetcher.mock.calls.find(([path]) =>
      path.includes('before='),
    )![0]
    expect(
      new URL(pageRequest, 'http://localhost').searchParams.get('before'),
    ).toBe(first[19].created_at)
  })
  it('expires an idle session without waiting for another API request', async () => {
    vi.useFakeTimers()
    saveSession({
      ...session,
      expires_at: new Date(Date.now() + 5000).toISOString(),
    })
    mockApi()
    mount('/jobs')
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(
      screen.getByRole('heading', { name: '欢迎回来' }),
    ).toBeInTheDocument()
  })
  it('refreshes an audio link only once automatically after playback errors', async () => {
    saveSession(session)
    const fetcher = mockApi()
    mount('/jobs/job-1')
    fireEvent.error(await screen.findByLabelText('生成的语音'))
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([path]) => path === '/api/jobs/job-1'),
      ).toHaveLength(2),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '刷新播放链接' }),
      ).toBeEnabled(),
    )
    fireEvent.error(screen.getByLabelText('生成的语音'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '音频暂时无法播放',
    )
    expect(
      fetcher.mock.calls.filter(([path]) => path === '/api/jobs/job-1'),
    ).toHaveLength(2)
  })
  it('clears the session after changing the current password', async () => {
    saveSession(session)
    const fetcher = mockApi((path) =>
      path === '/api/users/me/password'
        ? new Response(null, { status: 204 })
        : undefined,
    )
    mount('/account')
    await userEvent.type(
      await screen.findByLabelText('当前密码'),
      'old-password-123',
    )
    await userEvent.type(
      screen.getByLabelText('新密码', { exact: true }),
      '12345678',
    )
    await userEvent.type(
      screen.getByLabelText('确认新密码'),
      '12345678',
    )
    await userEvent.click(screen.getByRole('button', { name: '保存新密码' }))
    expect(
      await screen.findByRole('heading', { name: '欢迎回来' }),
    ).toBeInTheDocument()
    expect(readSession()).toBeNull()
    const call = fetcher.mock.calls.find(
      ([path]) => path === '/api/users/me/password',
    )!
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      current_password: 'old-password-123',
      new_password: '12345678',
    })
  })
  it('shows a new API key once and revokes keys after confirmation', async () => {
    saveSession(session)
    const created = {
      id: 3,
      name: 'CI',
      prefix: 'zvox_abcdefgh',
      created_at: '2026-10-25T10:00:00Z',
      expires_at: '2027-01-23T10:00:00Z',
      last_used_at: null,
    }
    let keys: (typeof created)[] = []
    const fetcher = mockApi((path, options) => {
      if (path === '/api/users/me/api-keys' && options?.method === 'POST') {
        keys = [created]
        return Response.json(
          { ...created, key: 'zvox_abcdefgh-secret' },
          { status: 201 },
        )
      }
      if (path === '/api/users/me/api-keys/3' && options?.method === 'DELETE') {
        keys = []
        return new Response(null, { status: 204 })
      }
      if (path === '/api/users/me/api-keys') return Response.json(keys)
    })
    const events = userEvent.setup()
    mount('/account')
    expect(await screen.findByText('还没有 API Key.')).toBeInTheDocument()
    await events.type(screen.getByLabelText('Key 名称'), '  CI  ')
    await events.click(screen.getByRole('button', { name: '创建 Key' }))
    expect(await screen.findByLabelText('新的 API Key')).toHaveValue(
      'zvox_abcdefgh-secret',
    )
    expect(screen.getByLabelText('Key 名称')).toHaveValue('')
    const call = fetcher.mock.calls.find(
      ([path, options]) =>
        path === '/api/users/me/api-keys' && options?.method === 'POST',
    )!
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      name: 'CI',
      expires_in_days: 90,
    })
    await events.click(screen.getByRole('button', { name: '复制' }))
    expect(await navigator.clipboard.readText()).toBe('zvox_abcdefgh-secret')
    expect(await screen.findByText('zvox_abcdefgh…')).toBeInTheDocument()
    expect(screen.getByText('从未使用')).toBeInTheDocument()
    expect(screen.queryByText(/zvox_abcdefgh-secret/)).not.toBeInTheDocument()
    await events.click(screen.getByRole('button', { name: '撤销' }))
    await events.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '确认操作',
      }),
    )
    expect(await screen.findByText('API Key "CI" 已撤销.')).toBeInTheDocument()
    expect(screen.queryByLabelText('新的 API Key')).not.toBeInTheDocument()
    expect(await screen.findByText('还没有 API Key.')).toBeInTheDocument()
  })
  it('creates a user and clears the submitted password', async () => {
    currentUser = { ...user, role: 'admin' }
    saveSession(session)
    const fetcher = mockApi((path, options) =>
      path === '/api/admin/users' && options?.method === 'POST'
        ? Response.json(
            { ...user, id: 2, username: 'new-user' },
            { status: 201 },
          )
        : undefined,
    )
    mount('/admin/users')
    await userEvent.type(await screen.findByLabelText('用户名'), 'new-user')
    await userEvent.type(screen.getByLabelText('初始密码'), '12345678')
    await userEvent.click(screen.getByRole('button', { name: '创建用户' }))
    expect(await screen.findByRole('status')).toHaveTextContent('用户已创建')
    expect(screen.getByLabelText('初始密码')).toHaveValue('')
    const call = fetcher.mock.calls.find(
      ([, options]) => options?.method === 'POST',
    )!
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      username: 'new-user',
      password: '12345678',
      role: 'user',
    })
  })
  it('keeps the last-admin error in the confirmation dialog and clears it for another operation', async () => {
    currentUser = { ...user, role: 'admin' }
    saveSession(session)
    mockApi((path, options) =>
      path === '/api/admin/users/1' && options?.method === 'PATCH'
        ? Response.json(
            { detail: 'Cannot disable or demote the last active admin' },
            { status: 409 },
          )
        : undefined,
    )
    mount('/admin/users')
    await userEvent.click(await screen.findByRole('button', { name: '停用' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '确认操作',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '不能停用或降级最后一位管理员',
    )
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await userEvent.click(screen.getByRole('button', { name: '重置密码' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('updates permissions immediately after an administrator changes their own role', async () => {
    currentUser = { ...user, role: 'admin' }
    saveSession(session)
    mockApi((path, options) => {
      if (path === '/api/admin/users/1' && options?.method === 'PATCH') {
        currentUser = { ...user, role: 'user' }
        return Response.json(currentUser)
      }
    })
    mount('/admin/users')
    await userEvent.click(
      await screen.findByRole('button', { name: '修改角色' }),
    )
    await userEvent.click(screen.getByRole('button', { name: '确认操作' }))
    expect(
      await screen.findByRole('heading', { name: '无权访问' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '用户管理' }),
    ).not.toBeInTheDocument()
  })
  it('submits an import only after confirmation and renders its errors', async () => {
    currentUser = { ...user, role: 'admin' }
    saveSession(session)
    let submitted = false
    const fetcher = mockApi((path) => {
      if (path === '/api/admin/speakers/sync') {
        submitted = true
        return Response.json({ status: 'already_running' })
      }
      if (path === '/api/admin/speakers/sync/status' && submitted)
        return Response.json({
          running: false,
          last_result: {
            imported: 0,
            deleted: 0,
            errors: [
              { key: 'speaker/1/vox-data.json', error: 'Metadata invalid' },
            ],
          },
        })
    })
    mount('/admin/system')
    await userEvent.click(
      await screen.findByRole('button', { name: '导入音色' }),
    )
    expect(
      fetcher.mock.calls.some(([path]) => path === '/api/admin/speakers/sync'),
    ).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '确认操作' }))
    expect(await screen.findByText(/Metadata invalid/)).toBeInTheDocument()
    expect(
      fetcher.mock.calls.filter(
        ([path]) => path === '/api/admin/speakers/sync',
      ),
    ).toHaveLength(1)
  })
  it('uploads an audio file, previews it, and makes the new voice selectable', async () => {
    saveSession(session)
    const createObjectURL = vi.fn().mockReturnValue('blob:preview')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    })
    let added = false
    const newSpeaker = { ...speaker, id: 2, name: '我的声音' }
    const fetcher = mockApi((path, options) => {
      if (path === '/api/speakers' && options?.method === 'POST') {
        added = true
        return Response.json(newSpeaker, { status: 201 })
      }
      if (path === '/api/speakers/mine') return Response.json(added ? [newSpeaker] : [])
      if (path === '/api/speakers' && added) return Response.json([speaker, newSpeaker])
    })
    mount('/speakers')
    await screen.findByLabelText('参考音频')
    const events = userEvent.setup()
    await events.type(screen.getByLabelText('音色名称'), '我的声音')
    await events.type(screen.getByLabelText('音频对应文本'), '你好世界')
    await events.upload(screen.getByLabelText('参考音频'), new File(['audio'], 'voice.wav', { type: 'audio/wav' }))
    expect(screen.getByLabelText('参考音频试听')).toHaveAttribute('src', 'blob:preview')
    // jsdom 的原生 required 校验看不到 user-event 模拟的 FileList.
    fireEvent.submit(screen.getByLabelText('音色名称').closest('form')!)
    expect(await screen.findByRole('status')).toHaveTextContent('我的声音')
    const [path, options] = fetcher.mock.calls.find(
      ([callPath, callOptions]) => callPath === '/api/speakers' && callOptions?.method === 'POST',
    )!
    expect(path).toBe('/api/speakers')
    const body = options?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('prompt_text')).toBe('你好世界')
    expect(body.get('publish')).toBe('false')
    expect((body.get('audio') as File).name).toBe('voice.wav')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    await events.click(screen.getByRole('link', { name: '前往工作台' }))
    await events.click(await screen.findByRole('button', { name: /我的声音/ }))
    expect(screen.getByRole('button', { name: /我的声音/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('keeps the form available after upload failure and rejects oversized files', async () => {
    saveSession(session)
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn().mockReturnValue('blob:preview')
      static revokeObjectURL = vi.fn()
    })
    const fetcher = mockApi((path, options) => {
      if (path === '/api/speakers' && options?.method === 'POST')
        return Response.json({ detail: '音频时长需大于 0 且不超过 30 秒.' }, { status: 400 })
      if (path === '/api/speakers/mine') return Response.json([])
    })
    mount('/speakers')
    await screen.findByLabelText('参考音频')
    const events = userEvent.setup()
    await events.type(screen.getByLabelText('音色名称'), '我的声音')
    await events.type(screen.getByLabelText('音频对应文本'), '你好世界')
    await events.upload(screen.getByLabelText('参考音频'), new File(['audio'], 'voice.wav', { type: 'audio/wav' }))
    fireEvent.submit(screen.getByLabelText('音色名称').closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('30 秒')
    expect(screen.getByLabelText('音色名称')).toHaveValue('我的声音')
    const large = new File(['audio'], 'large.wav', { type: 'audio/wav' })
    Object.defineProperty(large, 'size', { value: 20 * 1024 * 1024 + 1 })
    await events.upload(screen.getByLabelText('参考音频'), large)
    expect(screen.getByRole('alert')).toHaveTextContent('20 MB')
    expect(screen.getByRole('button', { name: '创建音色' })).toBeDisabled()
    const writes = fetcher.mock.calls.filter(
      ([path, options]) => path === '/api/speakers' && options?.method === 'POST',
    )
    expect(writes).toHaveLength(1)
  })
  it('shows plaza voices with creators and presets the studio selection', async () => {
    saveSession(session)
    const publicVoice = {
      ...speaker,
      id: 3,
      name: '山语',
      owner_id: 2,
      owner_username: 'creator2',
      status: 'approved',
      review_comment: null,
      audio_url: 'https://example.invalid/a.wav',
    }
    mockApi((path) => {
      if (path === '/api/speakers/plaza') return Response.json([publicVoice])
      if (path === '/api/speakers') return Response.json([speaker, publicVoice])
    })
    mount('/plaza')
    expect(await screen.findByText('山语')).toBeInTheDocument()
    expect(screen.getByText('创建者 creator2')).toBeInTheDocument()
    expect(screen.getByText('公开')).toBeInTheDocument()
    expect(screen.getByLabelText('试听参考音频')).toHaveAttribute(
      'src',
      'https://example.invalid/a.wav',
    )
    await userEvent.click(screen.getByRole('button', { name: '使用该音色' }))
    expect(await screen.findByRole('button', { name: /山语/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
  it('submits a private voice for plaza review and withdraws it after approval', async () => {
    saveSession(session)
    let mine = [
      {
        ...speaker,
        id: 7,
        owner_id: user.id,
        owner_username: user.username,
        status: 'private',
        review_comment: null,
        audio_url: null,
      },
    ]
    mockApi((path, options) => {
      if (path === '/api/speakers/mine') return Response.json(mine)
      if (path === '/api/speakers/7/submit' && options?.method === 'POST') {
        mine = [{ ...mine[0], status: 'pending' }]
        return new Response(null, { status: 204 })
      }
      if (path === '/api/speakers/7/withdraw' && options?.method === 'POST') {
        mine = [{ ...mine[0], status: 'private' }]
        return new Response(null, { status: 204 })
      }
    })
    const events = userEvent.setup()
    mount('/speakers')
    expect(await screen.findByText('私有')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建音色' })).toBeInTheDocument()
    await events.click(screen.getByRole('button', { name: '申请公开' }))
    expect(await screen.findByText('审核中')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '申请公开' })).not.toBeInTheDocument()
    await events.click(screen.getByRole('button', { name: '撤回审核' }))
    expect(await screen.findByText('已撤回公开申请.')).toBeInTheDocument()
    expect(await screen.findByText('私有')).toBeInTheDocument()
  })
  it('approves and rejects plaza submissions with a comment as an administrator', async () => {
    currentUser = { ...user, role: 'admin' }
    saveSession(session)
    let reviews = [
      {
        ...speaker,
        id: 9,
        owner_id: 2,
        owner_username: 'creator2',
        status: 'pending',
        review_comment: null,
        audio_url: null,
      },
    ]
    const decisions: unknown[] = []
    mockApi((path, options) => {
      if (path === '/api/admin/speakers/reviews') return Response.json(reviews)
      if (path === '/api/admin/speakers/9/review' && options?.method === 'POST') {
        decisions.push(JSON.parse(options!.body as string))
        reviews = []
        return Response.json({ ...speaker, id: 9, status: 'approved' })
      }
    })
    const events = userEvent.setup()
    mount('/admin/reviews')
    expect(await screen.findByText('创建者 creator2')).toBeInTheDocument()
    await events.click(screen.getByRole('button', { name: '驳回' }))
    await events.type(screen.getByLabelText('驳回原因 (可选)'), '音质不足')
    await events.click(screen.getByRole('button', { name: '确认驳回' }))
    expect(await screen.findByText(/已驳回音色/)).toBeInTheDocument()
    expect(await screen.findByText('暂无待审核音色')).toBeInTheDocument()
    expect(decisions).toEqual([{ decision: 'reject', comment: '音质不足' }])
  })
})
