import { getHostKey, getParticipantToken } from './storage.js'

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function request(method, path, { tableId, body, signal } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (tableId) {
    const host = getHostKey(tableId)
    const me = getParticipantToken(tableId)
    if (host) headers['X-Host-Key'] = host
    if (me) headers['X-Participant-Token'] = me
  }
  let res
  try {
    const API_BASE = import.meta.env.VITE_API_URL || ''

res = await fetch(`${API_BASE}/api${path}`, {
  method,
  headers,
  body: body === undefined ? undefined : JSON.stringify(body),
  signal
})
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`)
  return data
}

const t = (id) => `/tables/${encodeURIComponent(id)}`

export const api = {
  createTable: (body) => request('POST', '/tables', { body }),
  getTable: (id, signal) => request('GET', t(id), { tableId: id, signal }),
  updateTable: (id, body) => request('PATCH', t(id), { tableId: id, body }),
  addItem: (id, body) => request('POST', `${t(id)}/items`, { tableId: id, body }),
  updateItem: (id, itemId, body) => request('PATCH', `${t(id)}/items/${itemId}`, { tableId: id, body }),
  deleteItem: (id, itemId) => request('DELETE', `${t(id)}/items/${itemId}`, { tableId: id }),
  loadSample: (id) => request('POST', `${t(id)}/sample`, { tableId: id }),
  finalize: (id) => request('POST', `${t(id)}/finalize`, { tableId: id }),
  unlock: (id) => request('POST', `${t(id)}/unlock`, { tableId: id }),
  join: (id, name) => request('POST', `${t(id)}/participants`, { tableId: id, body: { name } }),
  claim: (id, itemId, claimed) => request('POST', `${t(id)}/claim`, { tableId: id, body: { itemId, claimed } }),
  setHostWallet: (id, hostWallet) => request('PATCH', `${t(id)}/stellar-wallet`, { tableId: id, body: { hostWallet } }),
  submitPayment: (id, txHash) => request('POST', `${t(id)}/payments`, { tableId: id, body: { txHash } }),
  getPayments: (id) => request('GET', `${t(id)}/payments`, { tableId: id }),
}
