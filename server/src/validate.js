import { badRequest } from './errors.js'
import { MAX_TAX_BP, MAX_TIP_BP, parseXlmToStroops, parsePercentToBp } from './money.js'

export function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object.')
  return body
}

export function text(value, field, max, { optional = false } = {}) {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') throw badRequest(`${field} is required.`)
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) throw badRequest(`${field} can’t be empty.`)
  if (clean.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`)
  return clean
}

export function price(value) {
  const stroops = parseXlmToStroops(value)
  if (stroops === null) throw badRequest('Price must be a positive XLM amount with at most 7 decimals (max 100,000,000 XLM).')
  return stroops
}

export function taxPercent(value, { optional = false } = {}) {
  if (value === undefined && optional) return undefined
  const bp = parsePercentToBp(value, MAX_TAX_BP)
  if (bp === null) throw badRequest('Tax must be a percentage from 0 to 50, with at most 2 decimals.')
  return bp
}

export function tipPercent(value, { optional = false } = {}) {
  if (value === undefined && optional) return undefined
  const bp = parsePercentToBp(value, MAX_TIP_BP)
  if (bp === null) throw badRequest('Tip must be a percentage from 0 to 100, with at most 2 decimals.')
  return bp
}

export function id(value, field) {
  const s = typeof value === 'number' ? String(value) : value
  if (typeof s !== 'string' || !/^\d{1,18}$/.test(s)) throw badRequest(`${field} is invalid.`)
  return s
}

export function bool(value, field) {
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`)
  return value
}
