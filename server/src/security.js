import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

// Short share codes: 6 chars from 31 unambiguous symbols (no 0/o, 1/l/i) ≈ 887 million codes.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const TABLE_ID_PATTERN = /^[a-hjkmnp-z2-9]{6}$/

export function newTableId() {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

// Long random secrets (host key, participant token). Only their hashes are stored.
export function newSecret() {
  return randomBytes(24).toString('base64url')
}

export function hashSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex')
}

export function secretMatches(secret, hash) {
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > 200) return false
  const a = Buffer.from(hashSecret(secret), 'hex')
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
