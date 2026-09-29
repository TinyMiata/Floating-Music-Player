export interface MediaSession {
  id: string
  playing: boolean
  title: string
  artist: string
  album: string
  posMs: number
  durMs: number
  canToggle: boolean
  canNext: boolean
  canPrev: boolean
  canSeek: boolean
  key: string
  thumb?: string
}

export type SourceKind = 'spotify' | 'ytmusic' | 'media'

// Chrome/Edge report an opaque hashed id (e.g. F0DC299D809B9700) instead of an exe name
const BROWSER = /chrome|msedge|edge|firefox|brave|opera|vivaldi|arc|^[0-9A-F]{16}$/i
const YTM_APP = /youtube[-_. ]?music|th-ch|ytmd|music\.youtube/i

export const isBrowserId = (id: string): boolean => BROWSER.test(id)

/**
 * Decide which supported service (if any) a Windows media session belongs to.
 * Browsers only expose track metadata, not the site, so YouTube Music is detected by its
 * shape: real songs carry an album, and auto-generated artist channels end in "- Topic".
 * `anyBrowser` treats every browser session as YouTube Music (covers music videos with no album).
 * Anything else that plays media is returned as 'media' so it still shows up and can be controlled.
 */
export function classify(s: Pick<MediaSession, 'id' | 'album' | 'artist'>, anyBrowser = false): SourceKind {
  if (/spotify/i.test(s.id)) return 'spotify'
  if (YTM_APP.test(s.id)) return 'ytmusic'
  if (BROWSER.test(s.id) && (anyBrowser || s.album.trim() !== '' || /- Topic$/i.test(s.artist.trim()))) return 'ytmusic'
  return 'media'
}
