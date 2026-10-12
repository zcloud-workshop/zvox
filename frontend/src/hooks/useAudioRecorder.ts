import { useEffect, useRef, useState } from 'react'
import { encodeWav } from '../audio/wav'

type RecordingState = 'idle' | 'requesting' | 'recording' | 'processing'

export function useAudioRecorder(onRecorded: (file: File) => void) {
  const [state, setState] = useState<RecordingState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const session = useRef<{ dispose: () => void; stop: () => void } | null>(null)
  const supported = !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined'

  useEffect(() => () => {
    session.current?.dispose()
    session.current = null
  }, [])

  async function start() {
    if (!supported || session.current) return
    let cancelled = false
    let stream: MediaStream | undefined
    let recorder: MediaRecorder | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    const release = () => {
      clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
    const dispose = () => {
      cancelled = true
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      release()
    }
    const fail = (message: string) => {
      if (cancelled) return
      dispose()
      session.current = null
      setError(message)
      setState('idle')
    }
    const stop = () => {
      if (recorder?.state === 'recording') {
        setState('processing')
        recorder.stop()
        release()
      }
    }
    session.current = { dispose, stop }
    setError('')
    setSeconds(0)
    setState('requesting')
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (cancelled) {
        release()
        return
      }
      recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => fail('录音中断, 请检查麦克风后重新录制.')
      recorder.onstop = async () => {
        release()
        if (cancelled) return
        setState('processing')
        let context: AudioContext | undefined
        try {
          const blob = new Blob(chunks, { type: recorder!.mimeType })
          if (!blob.size) throw new Error('Empty recording')
          context = new AudioContext()
          const audio = await context.decodeAudioData(await blob.arrayBuffer())
          if (cancelled) return
          if (!audio.length) throw new Error('Empty audio')
          onRecorded(new File([encodeWav(audio)], 'recording.wav', { type: 'audio/wav' }))
          session.current = null
          setState('idle')
        } catch {
          fail('无法处理录音, 请重新录制或上传音频文件.')
        } finally {
          if (context) await context.close()
        }
      }
      recorder.start()
      setState('recording')
      const started = Date.now()
      timer = setInterval(() => {
        const elapsed = (Date.now() - started) / 1000
        setSeconds(Math.min(30, Math.floor(elapsed)))
        if (elapsed >= 30) stop()
      }, 250)
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : ''
      fail(name === 'NotAllowedError'
        ? '麦克风权限被拒绝, 请在浏览器设置中允许访问后重试.'
        : name === 'NotFoundError'
          ? '未找到麦克风, 请连接设备后重试.'
          : '无法启动录音, 请检查麦克风是否被占用后重试.')
    }
  }

  function cancel() {
    session.current?.dispose()
    session.current = null
    setState('idle')
  }

  return { state, seconds, error, supported, start, stop: () => session.current?.stop(), cancel }
}
