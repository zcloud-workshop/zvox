import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { createSpeaker } from '../api/speakers'
import { useAction } from '../hooks/useAction'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { ErrorNotice } from './Feedback'

const readingText = '清晨的阳光洒在窗前, 微风轻轻吹过树梢, 我用温暖的声音迎接美好的一天.'

export function SpeakerUpload({ onCreated }: { onCreated?: () => void }) {
  const action = useAction()
  const form = useRef<HTMLFormElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [promptText, setPromptText] = useState('')
  const [recorded, setRecorded] = useState(false)
  const [preview, setPreview] = useState('')
  const [notice, setNotice] = useState('')
  const recording = useAudioRecorder((audio) => {
    selectAudio(audio)
    setRecorded(true)
    if (fileInput.current) fileInput.current.value = ''
  })
  const recordingBusy = recording.state !== 'idle'
  const fileError = file && file.size > 20 * 1024 * 1024
    ? '音频文件不能超过 20 MB.'
    : file && file.size === 0
      ? '音频文件不能为空.'
      : ''

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview)
  }, [preview])

  function selectAudio(selected: File | null) {
    setPreview(selected && selected.size > 0 && selected.size <= 20 * 1024 * 1024
      ? URL.createObjectURL(selected)
      : '')
    setFile(selected)
    setRecorded(false)
    setNotice('')
    action.clearError()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || fileError || recordingBusy) return
    const body = new FormData(event.currentTarget)
    body.set('audio', file)
    void action.run(async () => {
      setNotice('')
      const speaker = await createSpeaker(body)
      form.current?.reset()
      setFile(null)
      setPreview('')
      setPromptText('')
      setRecorded(false)
      setNotice(`音色 "${speaker.name}" 已添加, 可在工作台选择使用.`)
      onCreated?.()
    })
  }

  return (
    <section className="panel speaker-upload" aria-labelledby="upload-title">
      <h2 id="upload-title">添加音频</h2>
      <p className="muted small">上传或录制一段清晰的单人语音, 创建所有用户可用的音色.</p>
      <form ref={form} className="form-stack" onSubmit={submit}>
        <div className="settings-grid">
          <div className="upload-fields">
            <label>
              音色名称
              <input name="name" required maxLength={100} disabled={action.busy} />
            </label>
            <label>
              音色描述 (可选)
              <input name="description" maxLength={500} disabled={action.busy} />
            </label>
            <label>
              音频对应文本
              <textarea name="prompt_text" required maxLength={4096} rows={3} disabled={action.busy || recordingBusy}
                value={promptText} onChange={(event) => setPromptText(event.target.value)} />
            </label>
            <p className="field-hint">准确填写音频中说出的内容, 用于语音克隆.</p>
          </div>
          <div className="upload-fields">
            <label>
              参考音频
              <input
                ref={fileInput}
                name="audio"
                type="file"
                accept=".wav,.mp3,.flac,.ogg,audio/wav,audio/mpeg,audio/flac,audio/ogg"
                required={!file}
                disabled={action.busy || recordingBusy}
                aria-describedby="audio-hint"
                aria-invalid={!!fileError}
                onChange={(event) => {
                  selectAudio(event.target.files?.[0] ?? null)
                }}
              />
            </label>
            <p id="audio-hint" className="field-hint">支持 WAV, MP3, FLAC, OGG. 最长 30 秒, 最大 20 MB.</p>
            <div className="reference-recording">
              <div className="recording-heading">
                <strong>录制参考语音</strong>
                <span className={recording.state === 'recording' ? 'recording-time active' : 'recording-time'}>
                  {String(recording.seconds).padStart(2, '0')} / 30 秒
                </span>
              </div>
              <p className="field-hint">在安静环境中自然朗读, 30 秒后自动停止.</p>
              <p className="reading-example">{readingText}</p>
              <button type="button" className="text-button" disabled={action.busy || recordingBusy}
                onClick={() => setPromptText(readingText)}>填入朗诵文本</button>
              <div className="button-row">
                {recording.state === 'recording' ? (
                  <button type="button" className="button secondary danger-text" onClick={recording.stop}>停止录音</button>
                ) : (
                  <button type="button" className="button secondary"
                    disabled={action.busy || recordingBusy || !recording.supported}
                    onClick={() => {
                      setNotice('')
                      action.clearError()
                      void recording.start()
                    }}>
                    {recording.state === 'requesting' ? '等待麦克风授权...'
                      : recording.state === 'processing' ? '正在处理录音...'
                        : recorded ? '重新录制' : '开始录音'}
                  </button>
                )}
                {recording.state === 'requesting' && (
                  <button type="button" className="button secondary" onClick={recording.cancel}>取消录音</button>
                )}
              </div>
              {!recording.supported && <p className="field-hint">录音需使用支持录音的浏览器, 并通过 HTTPS 或 localhost 访问. 也可直接上传音频.</p>}
              <ErrorNotice message={recording.error} />
            </div>
            {recorded && !recordingBusy && <p className="field-hint">录音已就绪, 请试听并确认音频对应文本与朗读内容一致.</p>}
            {preview && file && !fileError && !recordingBusy && (
              <audio controls src={preview} aria-label="参考音频试听" />
            )}
            <ErrorNotice message={fileError} />
          </div>
        </div>
        <ErrorNotice message={action.error} />
        {notice && <p className="notice success" role="status">{notice}</p>}
        <div className="button-row">
          <button className="button primary" disabled={action.busy || recordingBusy || !file || !!fileError}>
            {action.busy ? '正在上传...' : '上传并添加音色'}
          </button>
          <Link className="button secondary" to="/">前往工作台</Link>
        </div>
      </form>
    </section>
  )
}
