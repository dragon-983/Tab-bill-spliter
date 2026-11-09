// Secrets this browser holds for each table: the host key (if it created the table)
// and its participant token (if it joined). They're sent as headers, never in URLs.
const read = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k, v) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode / storage full: works for this session only */
  }
}

export const getHostKey = (tableId) => read(`tab:host:${tableId}`)
export const setHostKey = (tableId, key) => write(`tab:host:${tableId}`, key)
export const getParticipantToken = (tableId) => read(`tab:me:${tableId}`)
export const setParticipantToken = (tableId, token) => write(`tab:me:${tableId}`, token)
