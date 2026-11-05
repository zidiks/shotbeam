import { describe, expect, it } from 'vitest'
import { wavPeaks } from './waveform'

/** A 16-bit mono WAV of the given samples, with an extra chunk before the data. */
function wav(samples: number[], sampleRate = 1000) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => {
    data.writeInt16LE(v, i * 2)
  })
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(1, 10)
  fmt.writeUInt32LE(sampleRate, 12)
  fmt.writeUInt32LE(sampleRate * 2, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)
  const list = Buffer.from('LIST\x03\x00\x00\x00abc\x00', 'binary')
  const head = Buffer.alloc(8)
  head.write('data', 0, 'ascii')
  head.writeUInt32LE(data.length, 4)
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + fmt.length + list.length + head.length + data.length, 4)
  riff.write('WAVE', 8, 'ascii')
  return Buffer.concat([riff, fmt, list, head, data])
}

describe('waveform', () => {
  it('takes the loudest sample of each window, past padded chunks', () => {
    // 1000 Hz at 100 peaks/s: windows of 10 samples.
    const samples = [
      ...Array(10).fill(0),
      ...Array(9).fill(100).concat([-16384]),
      ...Array(5).fill(32767),
    ]
    const w = wavPeaks(wav(samples))
    expect(w.rate).toBe(100)
    expect(w.peaks).toEqual([0, 0.5, 1])
  })

  it('refuses what is not a WAV', () => {
    expect(() => wavPeaks(Buffer.from('nope, not audio'))).toThrow('Not a WAV')
  })
})
