import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from './client'
import { readSession, saveSession, sessionEvent } from '../auth/session'

const session = {
  access_token: 'test-token',
  expires_at: '2099-01-01T00:00:00Z',
}
describe('API requests', () => {
  beforeEach(() => saveSession(session))
  it('sends multipart data unchanged and lets the browser set its boundary', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 2 }))
    vi.stubGlobal('fetch', fetcher)
    const body = new FormData()
    body.append('audio', new File(['audio'], 'sample.wav', { type: 'audio/wav' }))
    await request('/admin/speakers', { method: 'POST', body })
    expect(fetcher.mock.calls[0][1].body).toBe(body)
    expect(fetcher.mock.calls[0][1].headers.has('Content-Type')).toBe(false)
    expect(fetcher.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-token')
  })
  it('adds authentication only to protected API requests and handles 204', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      request('/auth/logout', { method: 'POST' }),
    ).resolves.toBeUndefined()
    expect(fetcher.mock.calls[0][1].headers.get('Authorization')).toBe(
      'Bearer test-token',
    )
    await request('/auth/login', { method: 'POST', auth: false })
    expect(fetcher.mock.calls[1][1].headers.has('Authorization')).toBe(false)
  })
  it('clears an expired protected session but preserves it for failed login', async () => {
    const listener = vi.fn()
    window.addEventListener(sessionEvent, listener)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            Response.json(
              { detail: 'Invalid username or password' },
              { status: 401 },
            ),
          ),
        ),
    )
    await expect(request('/auth/login', { auth: false })).rejects.toMatchObject(
      { status: 401 },
    )
    expect(readSession()?.access_token).toBe('test-token')
    expect(listener).not.toHaveBeenCalled()
    await expect(request('/jobs')).rejects.toMatchObject({ status: 401 })
    expect(readSession()).toBeNull()
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(sessionEvent, listener)
  })
  it('does not invalidate a newer login when an older request returns 401', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          }),
      ),
    )
    const pending = request('/jobs')
    saveSession({ ...session, access_token: 'new-token' })
    resolve(Response.json({ detail: 'expired' }, { status: 401 }))
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(readSession()?.access_token).toBe('new-token')
  })
  it('maps FastAPI validation fields and handles non-JSON failures', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { detail: [{ loc: ['body', 'text'], msg: 'Too long' }] },
          { status: 422 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('<html>Bad gateway</html>', { status: 502 }),
      )
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/jobs')).rejects.toThrow('文本: Too long')
    await expect(request('/jobs')).rejects.toThrow('服务暂时不可用')
  })
  it('does not retry ambiguous creation failures', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      request('/jobs', {
        method: 'POST',
        body: { speaker_id: 1, text: '你好' },
      }),
    ).rejects.toMatchObject({ status: 0 })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('shows the login rate limit without clearing a session or retrying', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({ detail: 'Too many login attempts' }, { status: 429 }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/auth/login', { auth: false })).rejects.toThrow(
      '登录尝试过于频繁, 请稍后重试.',
    )
    expect(readSession()?.access_token).toBe('test-token')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects expired stored sessions before sending a request', async () => {
    saveSession({ ...session, expires_at: '2000-01-01T00:00:00Z' })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/jobs')).rejects.toMatchObject({ status: 401 })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
