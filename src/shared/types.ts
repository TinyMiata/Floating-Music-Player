export type SourceId = 'spotify' | 'ytmusic' | 'youtube' | 'tidal' | 'media'

export interface TrackState {
  source: SourceId
  canVolume: boolean
  canSeek: boolean
  canLibrary: boolean
  isPlaying: boolean
  title: string
  artist: string
  album: string
  imageUrl: string | null
  progressMs: number
  durationMs: number
  volume: number | null
  /** Shareable link to the current song, when known */
  url: string | null
  deviceName: string | null
  /** Timestamp (ms) at which progressMs was sampled */
  sampledAt: number
}

export interface AlbumItem {
  uri: string
  name: string
  artist: string
  imageUrl: string | null
  kind: 'album' | 'playlist'
}

export type AuthStatus = 'needs-client-id' | 'logged-out' | 'logged-in'

export interface PlayerUpdate {
  auth: AuthStatus
  track: TrackState | null
  error: string | null
  /** True while the browser extension is connected */
  extension: boolean
  /** True when browser media is playing but the extension is not connected (so installing it would help) */
  extensionNeeded: boolean
  /** True while the window is in cover mode (square, album art only) */
  cover: boolean
  /** True when the visualizer follows only the playing app's audio (rather than everything the PC plays) */
  scoped: boolean
}

export interface ExtInstallInfo {
  dir: string
  browser: 'chrome' | 'edge' | 'brave' | 'opera' | 'vivaldi' | 'firefox' | 'unknown'
  /** The extensions page for that browser (also copied to the clipboard) */
  url: string | null
  /** Whether the app managed to open that page itself */
  opened: boolean
}

export interface FloatingApi {
  getUpdate(): Promise<PlayerUpdate>
  onUpdate(cb: (u: PlayerUpdate) => void): () => void
  /** 128 spectrum bytes (Web Audio analyser scaling) of the playing app's audio only */
  onSpectrum(cb: (bins: Uint8Array) => void): () => void
  setClientId(id: string): Promise<void>
  login(): Promise<void>
  logout(): Promise<void>
  togglePlay(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  setVolume(percent: number): Promise<void>
  seek(ms: number): Promise<void>
  /** Shows the native right-click menu */
  showMenu(): Promise<void>
  listLibrary(): Promise<AlbumItem[]>
  playContext(uri: string): Promise<void>
  setExpanded(expanded: boolean): Promise<void>
  /** Switches between the normal player and the square album-art-only cover mode */
  setCover(on: boolean): Promise<void>
  /** Starts dragging the window ('move') or resizing it from a corner; deltas are then sent with gestureMove */
  gestureStart(kind: 'move' | 'grip' | 'nw' | 'ne' | 'sw' | 'se'): Promise<void>
  gestureMove(dx: number, dy: number): Promise<void>
  gestureEnd(): Promise<void>
  setOpacity(value: number): Promise<void>
  showSetup(): Promise<void>
  /** Prepares the extension folder, opens the default browser's extensions page, and reports what it did */
  installExtension(): Promise<ExtInstallInfo>
  quit(): Promise<void>
}
