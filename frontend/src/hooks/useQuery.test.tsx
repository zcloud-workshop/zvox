import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { useQuery } from './useQuery'
import { useAction } from './useAction'

describe('query lifecycle', () => {
  it('polls sequentially and stops when the task completes', async () => {
    vi.useFakeTimers()
    const load = vi
      .fn()
      .mockResolvedValueOnce('running')
      .mockResolvedValue('completed')
    const poll = (status: string) => (status === 'running' ? 2000 : 0)
    const { result, unmount } = renderHook(() => useQuery(load, poll))
    await act(async () => {})
    expect(result.current.data).toBe('running')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current.data).toBe('completed')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })
    expect(load).toHaveBeenCalledTimes(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not overlap slow requests and aborts on unmount', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const load = vi.fn((next: AbortSignal) => {
      signal = next
      return new Promise<string>(() => {})
    })
    const { unmount } = renderHook(() => useQuery(load, () => 2000))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })
    expect(load).toHaveBeenCalledOnce()
    unmount()
    expect(signal?.aborted).toBe(true)
  })
  it('pauses hidden pages and resumes with one request', async () => {
    vi.useFakeTimers()
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const load = vi.fn().mockResolvedValue('running')
    const poll = () => 2000
    renderHook(() => useQuery(load, poll))
    await act(async () => {})
    hidden = true
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000)
    })
    expect(load).toHaveBeenCalledOnce()
    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('backs off network failures and stops on inaccessible resources', async () => {
    vi.useFakeTimers()
    const load = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, '网络错误'))
      .mockRejectedValue(new ApiError(404, '不可访问'))
    const { result } = renderHook(() => useQuery(load))
    await act(async () => {})
    expect(result.current.error).toBe('网络错误')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current.error).toBe('不可访问')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('locks duplicate submissions before React rerenders', async () => {
    let release!: () => void
    const mutation = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const { result } = renderHook(() => useAction())
    let first!: Promise<void>
    act(() => {
      first = result.current.run(mutation)
      void result.current.run(mutation)
    })
    expect(mutation).toHaveBeenCalledOnce()
    expect(result.current.busy).toBe(true)
    await act(async () => {
      release()
      await first
    })
    expect(result.current.busy).toBe(false)
  })
})
