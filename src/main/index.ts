import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from 'electron'
import { join } from 'path'
import { copyFileSync, cpSync, existsSync, readFileSync } from 'fs'
import { clearTokens, getClientId, loadSettings, loadTokens, saveSettings } from './config'
import { login } from './auth'
import * as spotify from './spotify'
import { SmtcBridge } from './smtc'
import { classify, isBrowserId, type MediaSession, type SourceKind } from './classify'
import { BrowserBridge, type ExtTab } from './bridge'
import { detectDefaultBrowser, EXTENSIONS_URL, openInBrowser } from './browser'
import type { AuthStatus, ExtInstallInfo, PlayerUpdate, TrackState } from '../shared/types'

const COMPACT = { width: 380, height: 150 }
const EXPANDED = { width: 380, height: 430 }

let win: BrowserWindow | null = null
let tray: Tray | null = null
let spotifyTrack: TrackState | null = null
let sessions: MediaSession[] = []
let activeKey: string | null = null
let smtc: SmtcBridge | null = null
let browser: BrowserBridge | null = null
let lastError: string | null = null
let pollTimer: NodeJS.Timeout | null = null
let loggingIn = false

/** Copies the bundled extension to a stable, user-visible folder so "Load unpacked" keeps working after app updates */
function syncExtension(): string {
  const src = app.isPackaged ? join(process.resourcesPath, 'extension') : join(app.getAppPath(), 'extension')
  const dest = join(app.getPath('userData'), 'browser-extension')
  const manifest = join(dest, 'manifest.json')
  // Firefox has no MV3 service workers, so a Firefox install keeps its own manifest
  const wasFirefox = existsSync(manifest) && readFileSync(manifest, 'utf8').includes('"gecko"')
  cpSync(src, dest, { recursive: true })
  if (wasFirefox) copyFileSync(join(dest, 'manifest.firefox.json'), manifest)
  return dest
}

function authStatus(): AuthStatus {
  if (!getClientId()) return 'needs-client-id'
  return loadTokens() ? 'logged-in' : 'logged-out'
}

interface Candidate {
  key: string
  track: TrackState
  /** 'api' = Spotify Web API, 'smtc' = Windows media session */
  backend: 'api' | 'smtc' | 'ext'
  tabId?: number
  appId?: string
  session?: MediaSession
}

function fromSession(s: MediaSession, kind: SourceKind): TrackState {
  return {
    source: kind,
    canVolume: false,
    canSeek: s.canSeek && s.durMs > 0,
    canLibrary: false,
    isPlaying: s.playing,
    title: s.title,
    artist: s.artist.replace(/ - Topic$/i, ''),
    album: s.album,
    imageUrl: s.thumb ?? null,
    progressMs: s.posMs,
    durationMs: s.durMs,
    volume: null,
    url: null,
    deviceName: null,
    sampledAt: Date.now()
  }
}

function fromExtTab(t: ExtTab): TrackState {
  return {
    source: t.site,
    canVolume: true,
    canSeek: t.durMs > 0,
    canLibrary: false,
    isPlaying: t.playing,
    title: t.title,
    artist: t.artist.replace(/ - Topic$/i, ''),
    album: t.album,
    imageUrl: t.imageUrl || null,
    progressMs: t.posMs,
    durationMs: t.durMs,
    volume: t.volume,
    url: t.url || null,
    deviceName: null,
    sampledAt: t.seenAt
  }
}

function candidates(): Candidate[] {
  const list: Candidate[] = []
  if (spotifyTrack) list.push({ key: 'api', track: spotifyTrack, backend: 'api' })
  // The extension reports browser tabs exactly, so it replaces the guesswork from Windows sessions
  const extTabs = browser?.liveTabs() ?? []
  for (const t of extTabs) list.push({ key: `ext:${t.tabId}`, track: fromExtTab(t), backend: 'ext', tabId: t.tabId })
  const apiCoversSpotify = authStatus() === 'logged-in'
  const anyBrowser = !!loadSettings().ytmAnyBrowser
  for (const s of sessions) {
    const kind = classify(s, anyBrowser)
    if (!s.title) continue
    if (extTabs.length && isBrowserId(s.id)) continue
    if (kind === 'spotify' && apiCoversSpotify) continue // Web API gives richer data
    list.push({ key: s.id, track: fromSession(s, kind), backend: 'smtc', appId: s.id, session: s })
  }
  return list
}

/** Prefer whatever is playing; stay on the current source until it stops. */
function pickActive(): Candidate | null {
  const all = candidates()
  const current = all.find((c) => c.key === activeKey)
  if (current?.track.isPlaying) return current
  const pick = all.find((c) => c.track.isPlaying) ?? current ?? all[0] ?? null
  activeKey = pick?.key ?? null
  return pick
}

const EXT_GRACE_MS = 8000 // the extension reconnects within ~15s of the browser starting; don't nag before that
let extMissingSince: number | null = null

/** Browser media is present but the extension isn't reporting it: the extension is missing or disabled. */
function extensionNeeded(): boolean {
  const browserMedia = sessions.some((s) => s.title && isBrowserId(s.id))
  if (!browserMedia || browser?.connected) {
    extMissingSince = null
    return false
  }
  extMissingSince ??= Date.now()
  return Date.now() - extMissingSince > EXT_GRACE_MS
}

function snapshot(): PlayerUpdate {
  const active = pickActive()
  const showError = !active || active.backend === 'api'
  return { auth: authStatus(), track: active?.track ?? null, error: showError ? lastError : null, extension: !!browser?.connected, extensionNeeded: extensionNeeded() }
}

function push(): void {
  win?.webContents.send('player:update', snapshot())
}

async function poll(): Promise<void> {
  if (authStatus() !== 'logged-in') {
    spotifyTrack = null
    return
  }
  try {
    spotifyTrack = await spotify.getPlayback()
    lastError = null
  } catch (e) {
    const err = e as spotify.SpotifyError
    if (err.status === 401) {
      clearTokens()
      spotifyTrack = null
    }
    if (err.status !== 429) lastError = err.message
  }
  push()
}

function startPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(poll, 1500)
  void poll()
}

function extControl(cmd: 'toggle' | 'next' | 'prev' | 'seek' | 'volume', c: Candidate, value?: number): void {
  if (c.tabId === undefined) return
  browser?.send(c.tabId, cmd, value)
  if (cmd === 'toggle') browser?.patch(c.tabId, { playing: !c.track.isPlaying })
  if (cmd === 'volume') browser?.patch(c.tabId, { volume: value ?? 0 })
  if (cmd === 'seek') browser?.patch(c.tabId, { posMs: value ?? 0, seenAt: Date.now() })
  push()
}

function smtcControl(cmd: 'toggle' | 'next' | 'prev' | 'seek', c: Candidate, arg?: number): void {
  if (!c.appId) return
  smtc?.send(cmd, c.appId, arg)
  // Reflect a play/pause toggle immediately instead of waiting for the next media-session tick
  if (cmd === 'toggle' && c.session) {
    sessions = sessions.map((s) => (s.id === c.appId ? { ...s, playing: !s.playing } : s))
    push()
  }
}

/** Run a control action, then refresh state right away. */
async function control(fn: () => Promise<unknown>, optimistic?: () => void): Promise<void> {
  try {
    optimistic?.()
    if (optimistic) push()
    await fn()
    lastError = null
  } catch (e) {
    lastError = (e as Error).message
  }
  // Spotify takes a moment to reflect changes
  setTimeout(poll, 300)
  push()
}

function createWindow(): void {
  const settings = loadSettings()
  const area = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    ...COMPACT,
    x: settings.windowX ?? area.x + area.width - COMPACT.width - 20,
    y: settings.windowY ?? area.y + 20,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    opacity: settings.opacity ?? 1,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)

  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  win.webContents.on('did-finish-load', push)
  win.on('moved', () => {
    if (!win) return
    const [x, y] = win.getPosition()
    saveSettings({ windowX: x, windowY: y })
  })
  win.on('closed', () => (win = null))
}

function createTray(): void {
  const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build/icon.png')
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }))
  tray.setToolTip('Floating Music Player')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: () => (win?.isVisible() ? win.hide() : win?.show()) },
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: true,
        click: (i) => win?.setAlwaysOnTop(i.checked, 'screen-saver')
      },
      {
        label: 'Treat all browser media as YouTube Music',
        type: 'checkbox',
        checked: !!loadSettings().ytmAnyBrowser,
        click: (i) => {
          saveSettings({ ytmAnyBrowser: i.checked })
          push()
        }
      },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        enabled: app.isPackaged, // a dev build would register the bare Electron binary
        click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked })
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  tray.on('click', () => (win?.isVisible() ? win.hide() : win?.show()))
}

function registerIpc(): void {
  ipcMain.handle('player:get', () => snapshot())
  ipcMain.handle('auth:client-id', (_, id: string) => {
    saveSettings({ clientId: id.trim() })
    push()
  })
  ipcMain.handle('auth:login', async () => {
    if (loggingIn) return
    loggingIn = true
    try {
      await login()
      lastError = null
      startPolling()
      void poll()
    } catch (e) {
      lastError = (e as Error).message
    } finally {
      loggingIn = false
      push()
    }
  })
  ipcMain.handle('auth:logout', () => {
    clearTokens()
    spotifyTrack = null
    push()
  })
  ipcMain.handle('auth:show-setup', () => push())
  ipcMain.handle('ext:install', async (): Promise<ExtInstallInfo> => {
    const dest = syncExtension()

    const b = await detectDefaultBrowser()
    if (b.kind === 'firefox') {
      // Firefox has no MV3 service workers, so it uses its own manifest (same one that is uploaded to AMO)
      copyFileSync(join(dest, 'manifest.firefox.json'), join(dest, 'manifest.json'))
    }

    const url = EXTENSIONS_URL[b.kind]
    if (url) clipboard.writeText(url)
    let opened = false
    if (url && b.exe) {
      openInBrowser(b.exe, url)
      opened = true
    }
    void shell.openPath(dest)
    return { dir: dest, browser: b.kind, url, opened }
  })

  ipcMain.handle('player:toggle', () => {
    const a = pickActive()
    if (!a) return
    if (a.backend === 'ext') return extControl('toggle', a)
    if (a.backend === 'smtc') return smtcControl('toggle', a)
    // Capture before the optimistic update flips the flag, or we'd send the opposite command
    const wasPlaying = !!spotifyTrack?.isPlaying
    return control(
      () => (wasPlaying ? spotify.pause() : spotify.play()),
      () => spotifyTrack && (spotifyTrack = { ...spotifyTrack, isPlaying: !spotifyTrack.isPlaying, sampledAt: Date.now() })
    )
  })
  ipcMain.handle('player:next', () => {
    const a = pickActive()
    if (a?.backend === 'ext') return extControl('next', a)
    if (a?.backend === 'smtc') return smtcControl('next', a)
    return control(() => spotify.next())
  })
  ipcMain.handle('player:previous', () => {
    const a = pickActive()
    if (a?.backend === 'ext') return extControl('prev', a)
    if (a?.backend === 'smtc') return smtcControl('prev', a)
    return control(() => spotify.previous())
  })
  ipcMain.handle('player:volume', (_, p: number) => {
    const a = pickActive()
    if (a?.backend === 'ext') return extControl('volume', a, p)
    if (a?.backend === 'smtc') return // no per-app volume for Windows media sessions
    return control(() => spotify.setVolume(p), () => spotifyTrack && (spotifyTrack = { ...spotifyTrack, volume: p }))
  })
  const copyLink = (): boolean => {
    const url = pickActive()?.track.url
    if (url) clipboard.writeText(url)
    return !!url
  }
  ipcMain.handle('player:menu', () => {
    const has = !!pickActive()?.track.url
    Menu.buildFromTemplate([
      { label: 'Copy link', enabled: has, click: () => copyLink() }
    ]).popup({ window: win ?? undefined })
  })
  ipcMain.handle('player:seek', (_, ms: number) => {
    const a = pickActive()
    if (a?.backend === 'ext') return extControl('seek', a, ms)
    if (a?.backend === 'smtc') return smtcControl('seek', a, ms)
    return control(
      () => spotify.seek(ms),
      () => spotifyTrack && (spotifyTrack = { ...spotifyTrack, progressMs: ms, sampledAt: Date.now() })
    )
  })

  ipcMain.handle('library:list', async () => {
    try {
      return await spotify.listLibrary()
    } catch (e) {
      lastError = (e as Error).message
      push()
      return []
    }
  })
  ipcMain.handle('library:play', (_, uri: string) => control(() => spotify.playContext(uri)))

  ipcMain.handle('window:expand', (_, expanded: boolean) => {
    const size = expanded ? EXPANDED : COMPACT
    win?.setResizable(true)
    win?.setSize(size.width, size.height)
    win?.setResizable(false)
    // Growing downward can push the window off the bottom of the screen; slide it back up
    if (win) {
      const b = win.getBounds()
      const area = screen.getDisplayMatching(b).workArea
      const y = Math.max(area.y, Math.min(b.y, area.y + area.height - b.height))
      if (y !== b.y) win.setPosition(b.x, y)
    }
  })
  ipcMain.handle('window:opacity', (_, v: number) => {
    const opacity = Math.max(0.3, Math.min(1, v))
    win?.setOpacity(opacity)
    saveSettings({ opacity })
  })
  ipcMain.handle('app:quit', () => app.quit())
}

// Only one instance; the OAuth loopback port would otherwise clash.
if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(() => {
  // Keep an already-installed extension copy current (the browser just needs a reload to pick it up)
  if (existsSync(join(app.getPath('userData'), 'browser-extension'))) {
    try {
      syncExtension()
    } catch {
      /* folder may be locked by the browser; the next launch retries */
    }
  }
  // System-audio loopback for the visualizer (Windows)
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}))
  })

  registerIpc()
  createWindow()
  createTray()
  startPolling()
  smtc = new SmtcBridge((s) => {
    sessions = s
    push()
  })
  smtc.start()
  browser = new BrowserBridge(push)
  browser.start()
})

app.on('before-quit', () => {
  smtc?.stop()
  browser?.stop()
})

app.on('window-all-closed', () => app.quit())
