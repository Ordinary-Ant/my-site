export type MediaQuery = {
  q: string
  folder: string
  kind: '' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  page: number
}
export function readMediaQuery(params: URLSearchParams): MediaQuery {
  const kind = params.get('kind') ?? '',
    page = Number(params.get('page') ?? 1)
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    folder: params.get('folder') ?? '',
    kind: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(kind) ? (kind as MediaQuery['kind']) : '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
}
export function mediaQueryString(query: MediaQuery) {
  const params = new URLSearchParams()
  if (query.q.trim()) params.set('q', query.q.trim())
  if (query.folder) params.set('folder', query.folder)
  if (query.kind) params.set('kind', query.kind)
  if (query.page > 1) params.set('page', String(query.page))
  return params.toString()
}
