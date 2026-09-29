import { getAccessToken } from './auth'
import type { AlbumItem, TrackState } from '../shared/types'

const API = 'https://api.spotify.com/v1'

export class SpotifyError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

let retryAfterUntil = 0

async function call(method: string, path: string, body?: unknown): Promise<any> {
  if (Date.now() < retryAfterUntil) throw new SpotifyError('Rate limited', 429)
  const token = await getAccessToken()
  if (!token) throw new SpotifyError('Not authenticated', 401)
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  if (res.status === 429) {
    retryAfterUntil = Date.now() + (Number(res.headers.get('retry-after')) || 5) * 1000
    throw new SpotifyError('Rate limited', 429)
  }
  if (res.status === 204) return null
  if (!res.ok) {
    let msg = `Spotify error ${res.status}`
    try {
      const j = await res.json()
      msg = j?.error?.message ?? msg
    } catch {
      /* no body */
    }
    if (res.status === 403) msg = 'Spotify Premium is required for playback control'
    if (res.status === 404) msg = 'No active Spotify device - start playing on any device'
    throw new SpotifyError(msg, res.status)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export async function getPlayback(): Promise<TrackState | null> {
  const j = await call('GET', '/me/player')
  if (!j || !j.item) return null
  const item = j.item
  const images: { url: string }[] = item.album?.images ?? item.images ?? []
  const artist = Array.isArray(item.artists)
    ? item.artists.map((a: any) => a.name).join(', ')
    : (item.show?.publisher ?? '')
  return {
    source: 'spotify',
    canVolume: j.device?.volume_percent != null,
    canSeek: true,
    canLibrary: true,
    isPlaying: !!j.is_playing,
    title: item.name,
    artist,
    album: item.album?.name ?? item.show?.name ?? '',
    imageUrl: images[0]?.url ?? null,
    progressMs: j.progress_ms ?? 0,
    durationMs: item.duration_ms ?? 0,
    volume: j.device?.volume_percent ?? null,
    deviceName: j.device?.name ?? null,
    sampledAt: Date.now()
  }
}

export const play = () => call('PUT', '/me/player/play')
export const pause = () => call('PUT', '/me/player/pause')
export const next = () => call('POST', '/me/player/next')
export const previous = () => call('POST', '/me/player/previous')
export const setVolume = (p: number) =>
  call('PUT', `/me/player/volume?volume_percent=${Math.round(Math.max(0, Math.min(100, p)))}`)
export const seek = (ms: number) => call('PUT', `/me/player/seek?position_ms=${Math.round(ms)}`)
export const playContext = (uri: string) => call('PUT', '/me/player/play', { context_uri: uri })

const smallImage = (images?: { url: string }[]) => images?.[images.length > 1 ? 1 : 0]?.url ?? null

export async function listLibrary(): Promise<AlbumItem[]> {
  const [albums, playlists] = await Promise.all([
    call('GET', '/me/albums?limit=50'),
    call('GET', '/me/playlists?limit=50')
  ])
  const a: AlbumItem[] = (albums?.items ?? []).map(({ album }: any) => ({
    uri: album.uri,
    name: album.name,
    artist: (album.artists ?? []).map((x: any) => x.name).join(', '),
    imageUrl: smallImage(album.images),
    kind: 'album' as const
  }))
  const p: AlbumItem[] = (playlists?.items ?? []).filter(Boolean).map((pl: any) => ({
    uri: pl.uri,
    name: pl.name,
    artist: pl.owner?.display_name ?? 'Playlist',
    imageUrl: smallImage(pl.images),
    kind: 'playlist' as const
  }))
  return [...a, ...p]
}
