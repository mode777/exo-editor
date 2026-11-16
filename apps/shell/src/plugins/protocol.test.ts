import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_BYTES, payloadTooLarge } from './protocol'

describe('message byte cap', () => {
  it('measures strings as UTF-16 bytes', () => {
    expect(payloadTooLarge('x'.repeat(4), 8)).toBe(false)
    expect(payloadTooLarge('x'.repeat(5), 8)).toBe(true)
  })

  it('counts object keys and nested values', () => {
    expect(payloadTooLarge({ text: 'x'.repeat(4) }, 16)).toBe(false)
    expect(payloadTooLarge({ text: 'x'.repeat(4) }, 15)).toBe(true)
    expect(payloadTooLarge(['x'.repeat(4), 'y'.repeat(4)], 16)).toBe(false)
    expect(payloadTooLarge(['x'.repeat(4), 'y'.repeat(4)], 15)).toBe(true)
  })

  it('counts binary views by byte length', () => {
    expect(payloadTooLarge(new Uint8Array(8), 8)).toBe(false)
    expect(payloadTooLarge(new Uint8Array(9), 8)).toBe(true)
    expect(payloadTooLarge(new Uint8Array(4).buffer, 3)).toBe(true)
  })

  it('does not recurse forever on a cyclic payload', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(payloadTooLarge(cyclic, 100)).toBe(false)
  })

  it('uses the 16 MiB default cap', () => {
    expect(payloadTooLarge(new Uint8Array(MAX_MESSAGE_BYTES))).toBe(false)
    expect(payloadTooLarge(new Uint8Array(MAX_MESSAGE_BYTES + 1))).toBe(true)
  })
})
