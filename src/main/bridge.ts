import { WebSocketServer, type WebSocket } from 'ws'

export const BRIDGE_PORT = 53683
const STALE_MS = 3500

export interface ExtTab {
  tabId: number
  site: 'ytmusic' | 'youtube' | 'tidal'
  title: string
  artist: string
  album: string
  videoId: string
  imageUrl: string
  playing: boolean
  posMs: number
  durMs: number
  volume: number
  seenAt: number
}

/** Local WebSocket server that the browser extension connects to. */
export class BrowserBridge {
  private wss: WebSocketServer | null = null
  private tabs = new Map<number, ExtTab>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private onChange: () => void,
    private port = BRIDGE_PORT
  ) {}

  get connected(): boolean {
    return (this.wss?.clients.size ?? 0) > 0
  }

  liveTabs(): ExtTab[] {
    return [...this.tabs.values()]
  }

  start(): void {
    try {
      this.wss = new WebSocketServer({
        host: '127.0.0.1',
        port: this.port,
        // Web pages can open sockets to localhost too; only accept browser extensions.
        verifyClient: ({ origin }: { origin?: string }) => /^(chrome|moz)-extension:\/\//.test(origin ?? '')
      })
    } catch {
      return
    }
    this.wss.on('error', () => undefined) // e.g. port already in use
    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data) => this.onMessage(ws, data.toString()))
      ws.on('close', () => this.onChange())
      ws.on('error', () => undefined)
      this.onChange()
    })
    this.timer = setInterval(() => {
      const now = Date.now()
      let pruned = false
      for (const [id, t] of this.tabs) {
        if (now - t.seenAt > STALE_MS) {
          this.tabs.delete(id)
          pruned = true
        }
      }
      if (pruned) this.onChange()
    }, 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.wss?.close()
  }

  send(tabId: number, cmd: 'toggle' | 'next' | 'prev' | 'seek' | 'volume', value?: number): void {
    const msg = JSON.stringify({ type: 'cmd', tabId, cmd, value })
    this.wss?.clients.forEach((c) => c.send(msg))
  }

  /** Optimistic local update so the UI reacts before the tab's next report. */
  patch(tabId: number, patch: Partial<ExtTab>): void {
    const t = this.tabs.get(tabId)
    if (t) this.tabs.set(tabId, { ...t, ...patch })
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let m: any
    try {
      m = JSON.parse(raw)
    } catch {
      return
    }
    if (m.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }))
    } else if (m.type === 'gone' || (m.type === 'state' && m.gone)) {
      if (typeof m.tabId === 'number' && this.tabs.delete(m.tabId)) this.onChange()
    } else if (m.type === 'state' && typeof m.tabId === 'number') {
      this.tabs.set(m.tabId, {
        tabId: m.tabId,
        site: m.site === 'ytmusic' || m.site === 'tidal' ? m.site : 'youtube',
        title: String(m.title ?? ''),
        artist: String(m.artist ?? ''),
        album: String(m.album ?? ''),
        videoId: String(m.videoId ?? ''),
        imageUrl: String(m.imageUrl ?? ''),
        playing: !!m.playing,
        posMs: Number(m.posMs) || 0,
        durMs: Number(m.durMs) || 0,
        volume: Number(m.volume) || 0,
        seenAt: Date.now()
      })
      this.onChange()
    }
  }
}
