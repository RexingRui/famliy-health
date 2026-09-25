/**
 * UUIDv7: 48-bit millisecond timestamp + random bits. Record and attachment IDs are generated
 * on the client so a retried PUT is idempotent.
 */
export function uuidv7(now = Date.now()): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  let ts = now
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256
    ts = Math.floor(ts / 256)
  }
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
