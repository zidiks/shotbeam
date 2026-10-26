/** A short random id (12 hex characters): enough for one person's library, easy to read aloud. */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

export function nowIso(): string {
  return new Date().toISOString()
}
