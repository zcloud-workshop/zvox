import { useRef, useState } from 'react'
import { messageOf } from '../api/client'

export function useAction() {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError(messageOf(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return { busy, error, run, clearError: () => setError('') }
}
