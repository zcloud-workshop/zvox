export function encodeWav(audio: AudioBuffer): ArrayBuffer {
  // 浏览器停止录音可能稍有延迟, 导出的音频严格限制在 30 秒内.
  const frames = Math.min(audio.length, audio.sampleRate * 30)
  const output = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(output)
  const header = 'RIFF    WAVEfmt '
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i))
  view.setUint32(4, output.byteLength - 8, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, audio.sampleRate, true)
  view.setUint32(28, audio.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x64617461)
  view.setUint32(40, frames * 2, true)
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
  for (let i = 0; i < frames; i++) {
    let sample = 0
    for (const channel of channels) sample += channel[i] / channels.length
    sample = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }
  return output
}
