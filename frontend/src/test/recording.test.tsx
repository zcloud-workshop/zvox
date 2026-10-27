import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeWav } from '../audio/wav'
import { saveSession } from '../auth/session'
import { SpeakerUpload } from '../components/SpeakerUpload'
import { useAudioRecorder } from '../hooks/useAudioRecorder'

function audioBuffer(channels = [new Float32Array([0, 0.5, -0.5])], sampleRate = 48000) {
  return {
    length: channels[0].length,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (index: number) => channels[index],
  } as AudioBuffer
}

let recorder: FakeRecorder
class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['encoded audio']) })
      this.onstop?.()
    })
  }
}

const stopTrack = vi.fn()
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
const getUserMedia = vi.fn()
const decodeAudioData = vi.fn()
const close = vi.fn()

beforeEach(() => {
  getUserMedia.mockReset().mockResolvedValue(stream)
  decodeAudioData.mockReset().mockResolvedValue(audioBuffer())
  close.mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', vi.fn(function () {
    recorder = new FakeRecorder()
    return recorder
  }))
  vi.stubGlobal('AudioContext', class {
    decodeAudioData = decodeAudioData
    close = close
  })
  vi.stubGlobal('Blob', class extends Blob {
    arrayBuffer() { return Promise.resolve(new ArrayBuffer(8)) }
  })
})

describe('reference recording', () => {
  it('stops automatically at 30 seconds and releases the microphone', async () => {
    vi.useFakeTimers()
    const onRecorded = vi.fn()
    const { result } = renderHook(() => useAudioRecorder(onRecorded))
    await act(async () => { await result.current.start() })
    expect(result.current.state).toBe('recording')
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(result.current.state).toBe('idle')
    expect(result.current.seconds).toBe(30)
    expect(onRecorded).toHaveBeenCalledOnce()
    expect(onRecorded.mock.calls[0][0]).toMatchObject({ name: 'recording.wav', type: 'audio/wav', size: 50 })
    expect(stopTrack).toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports permission denial and allows another attempt', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    const { result, unmount } = renderHook(() => useAudioRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    expect(result.current.error).toContain('麦克风权限被拒绝')
    expect(result.current.state).toBe('idle')
    await act(async () => { await result.current.start() })
    expect(result.current.state).toBe('recording')
    expect(result.current.error).toBe('')
    unmount()
    expect(stopTrack).toHaveBeenCalled()
  })

  it('releases a microphone granted after leaving the page', async () => {
    let grant!: (stream: MediaStream) => void
    getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => { grant = resolve }))
    const onRecorded = vi.fn()
    const { result, unmount } = renderHook(() => useAudioRecorder(onRecorded))
    let pending!: Promise<void>
    act(() => { pending = result.current.start() })
    unmount()
    await act(async () => { grant(stream); await pending })
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(onRecorded).not.toHaveBeenCalled()
  })

  it('discards a recording when leaving during conversion', async () => {
    let decoded!: (audio: AudioBuffer) => void
    decodeAudioData.mockReturnValue(new Promise<AudioBuffer>((resolve) => { decoded = resolve }))
    const onRecorded = vi.fn()
    const { result, unmount } = renderHook(() => useAudioRecorder(onRecorded))
    await act(async () => { await result.current.start() })
    await act(async () => { result.current.stop() })
    expect(result.current.state).toBe('processing')
    unmount()
    await act(async () => { decoded(audioBuffer()) })
    expect(onRecorded).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('handles recorder and decoder failures without keeping the microphone open', async () => {
    const onRecorded = vi.fn()
    const { result } = renderHook(() => useAudioRecorder(onRecorded))
    await act(async () => { await result.current.start() })
    await act(async () => { recorder.onerror?.() })
    expect(result.current.error).toContain('录音中断')
    expect(result.current.state).toBe('idle')
    expect(stopTrack).toHaveBeenCalled()
    decodeAudioData.mockRejectedValueOnce(new Error('Invalid audio'))
    await act(async () => { await result.current.start() })
    await act(async () => { result.current.stop() })
    expect(result.current.error).toContain('无法处理录音')
    expect(result.current.state).toBe('idle')
    expect(onRecorded).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('previews and submits recorded WAV with the selected reading text', async () => {
    saveSession({ access_token: 'test', expires_at: new Date(Date.now() + 60000).toISOString() })
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 2, name: '我的录音' }))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn().mockReturnValue('blob:recording')
      static revokeObjectURL = vi.fn()
    })
    render(<MemoryRouter><SpeakerUpload /></MemoryRouter>)
    const events = userEvent.setup()
    await events.type(screen.getByLabelText('音色名称'), '我的录音')
    await events.click(screen.getByRole('button', { name: '填入朗诵文本' }))
    const text = (screen.getByLabelText('音频对应文本') as HTMLTextAreaElement).value
    expect(text.match(/[\u4e00-\u9fff]/g)).toHaveLength(31)
    await events.click(screen.getByRole('button', { name: '开始录音' }))
    expect(screen.getByRole('button', { name: '创建音色' })).toBeDisabled()
    expect(screen.getByLabelText('参考音频')).toBeDisabled()
    await events.click(screen.getByRole('button', { name: '停止录音' }))
    expect(await screen.findByLabelText('参考音频试听')).toHaveAttribute('src', 'blob:recording')
    expect(screen.getByLabelText('参考音频')).not.toBeRequired()
    await events.click(screen.getByRole('button', { name: '创建音色' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const body = fetcher.mock.calls[0][1].body as FormData
    expect(body.get('prompt_text')).toBe(text)
    expect(body.get('audio')).toMatchObject({ name: 'recording.wav', type: 'audio/wav' })
    expect(await screen.findByRole('status')).toHaveTextContent('我的录音')
    expect(screen.getByLabelText('音频对应文本')).toHaveValue('')
  })

  it('can replace a recording with an uploaded file', async () => {
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn().mockReturnValue('blob:preview')
      static revokeObjectURL = vi.fn()
    })
    render(<MemoryRouter><SpeakerUpload /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '开始录音' }))
    await userEvent.click(screen.getByRole('button', { name: '停止录音' }))
    expect(await screen.findByRole('button', { name: '重新录制' })).toBeEnabled()
    await userEvent.upload(screen.getByLabelText('参考音频'), new File(['audio'], 'upload.wav', { type: 'audio/wav' }))
    expect(screen.getByRole('button', { name: '开始录音' })).toBeEnabled()
    expect(screen.queryByText(/录音已就绪/)).not.toBeInTheDocument()
  })

  it('keeps upload available when recording is unsupported', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    render(<MemoryRouter><SpeakerUpload /></MemoryRouter>)
    expect(screen.getByRole('button', { name: '开始录音' })).toBeDisabled()
    expect(screen.getByLabelText('参考音频')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '填入朗诵文本' }))
    expect(screen.getByLabelText('音频对应文本')).not.toHaveValue('')
  })
})

describe('WAV encoding', () => {
  it('writes mono PCM16 with downmixing and clipping', () => {
    const audio = audioBuffer([
      new Float32Array([1, -1, 0.5, 2]),
      new Float32Array([1, -1, -0.5, 2]),
    ])
    const wav = encodeWav(audio)
    const view = new DataView(wav)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 16))).toBe('WAVEfmt ')
    expect(new TextDecoder().decode(wav.slice(36, 40))).toBe('data')
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(34, true)).toBe(16)
    expect([44, 46, 48, 50].map((offset) => view.getInt16(offset, true))).toEqual([32767, -32768, 0, 32767])
  })

  it('caps delayed browser recordings at exactly 30 seconds', () => {
    const wav = encodeWav(audioBuffer([new Float32Array(8000 * 31)], 8000))
    expect(wav.byteLength).toBe(44 + 8000 * 30 * 2)
    expect(new DataView(wav).getUint32(40, true)).toBe(8000 * 30 * 2)
  })
})
