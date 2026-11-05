/*
 * The shape of a sound for the timeline: the loudest sample in each short window, from the
 * 16-bit PCM WAV that indexing already extracts (audio.wav).
 */

/** Peaks per second of sound. */
export const WAVE_RATE = 100

export interface Waveform {
  rate: number
  /** 0..1 of full scale, one per 1/rate s. */
  peaks: number[]
}

/** Peaks of a 16-bit PCM WAV file's first channel. */
export function wavPeaks(wav: Buffer, rate = WAVE_RATE): Waveform {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file')
  }
  let channels = 1
  let sampleRate = 16000
  let bits = 16
  let offset = 12
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(body + 2)
      sampleRate = wav.readUInt32LE(body + 4)
      bits = wav.readUInt16LE(body + 14)
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`Expected 16-bit PCM, got ${bits}-bit`)
      const frame = 2 * channels
      const frames = Math.floor(Math.min(size, wav.length - body) / frame)
      const perPeak = Math.max(1, Math.round(sampleRate / rate))
      const peaks: number[] = []
      for (let f = 0; f < frames; f += perPeak) {
        let max = 0
        const end = Math.min(frames, f + perPeak)
        for (let i = f; i < end; i++) {
          const v = Math.abs(wav.readInt16LE(body + i * frame))
          if (v > max) max = v
        }
        peaks.push(Math.round((max / 32768) * 1000) / 1000)
      }
      return { rate: sampleRate / perPeak, peaks }
    }
    // Chunks are padded to an even length.
    offset = body + size + (size % 2)
  }
  throw new Error('WAV file has no data')
}
