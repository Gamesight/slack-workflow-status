import {compute_duration} from '../src/main'

describe('compute_duration', () => {
  function dur(ms: number): string {
    return compute_duration({
      start: new Date(0),
      end: new Date(ms),
    })
  }

  it('formats seconds only', () => {
    expect(dur(30_000)).toBe('30s')
  })

  it('formats minutes and seconds', () => {
    expect(dur(90_000)).toBe('1m 30s')
  })

  it('formats hours, minutes, and seconds', () => {
    expect(dur(3_661_000)).toBe('1h 1m 1s')
  })

  it('formats days, hours, minutes, and seconds', () => {
    const ms =
      1 * 86_400_000 + 2 * 3_600_000 + 3 * 60_000 + 4 * 1_000
    expect(dur(ms)).toBe('1d 2h 3m 4s')
  })

  it('renders zero as "0s" (seconds never hidden)', () => {
    expect(dur(0)).toBe('0s')
  })

  it('renders exactly one minute as "1m 0s"', () => {
    expect(dur(60_000)).toBe('1m 0s')
  })
})
