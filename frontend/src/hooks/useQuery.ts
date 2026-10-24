import { useCallback, useEffect, useState } from 'react'
import { ApiError, messageOf } from '../api/client'

// load 为 null 时不发起请求, 也不返回之前加载的数据.
export function useQuery<T>(
  load: ((signal: AbortSignal) => Promise<T>) | null,
  poll?: (data: T) => number,
) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    if (!load) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    let stopped = false
    let failures = 0
    const run = async () => {
      if (busy || stopped || controller.signal.aborted || document.hidden)
        return
      clearTimeout(timer)
      busy = true
      let delay = 0
      try {
        const result = await load(controller.signal)
        if (controller.signal.aborted) return
        setData(result)
        setError('')
        failures = 0
        delay = poll?.(result) ?? 0
        stopped = delay === 0
      } catch (error) {
        if (controller.signal.aborted) return
        setError(messageOf(error))
        stopped =
          error instanceof ApiError && [401, 403, 404].includes(error.status)
        delay = Math.min(2000 * 2 ** failures++, 30000)
      } finally {
        busy = false
        if (!controller.signal.aborted) {
          setLoading(false)
          if (!stopped && !document.hidden)
            timer = setTimeout(() => {
              void run()
            }, delay)
        }
      }
    }
    function onVisibility() {
      clearTimeout(timer)
      if (!document.hidden) void run()
    }
    void run()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load, poll, version])

  if (!load) return { data: undefined, error: '', loading: false, reload }
  return { data, error, loading, reload }
}
