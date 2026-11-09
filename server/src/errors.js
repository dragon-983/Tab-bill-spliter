export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const badRequest = (message) => new HttpError(400, 'invalid_request', message)
export const forbidden = (message = 'Only the host can do that.') => new HttpError(403, 'forbidden', message)
export const notFound = (what = 'Table') => new HttpError(404, 'not_found', `${what} not found.`)
export const conflict = (code, message) => new HttpError(409, code, message)
