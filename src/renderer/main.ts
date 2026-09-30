import type { AlbumItem, FloatingApi, PlayerUpdate, TrackState } from '../shared/types'
import 'remixicon/fonts/remixicon.css'
import { Visualizer } from './visualizer'

declare global {
  interface Window {
    api: FloatingApi
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const api = window.api

const setup = $('setup')
const player = $('player')
const setupMsg = $('setup-msg')
const clientInput = $<HTMLInputElement>('client-id')
const setupBtn = $<HTMLButtonElement>('setup-btn')
const art = $<HTMLImageElement>('art')
const progress = $<HTMLInputElement>('progress')
const volume = $<HTMLInputElement>('volume')
const errorEl = $('error')
const albumsEl = $('albums')

const SOURCE_LABEL = { spotify: 'Spotify', ytmusic: 'YouTube Music', youtube: 'YouTube', tidal: 'Tidal', media: 'Browser / Media' } as const
let skipped = false
let forceSetup = false // set by the connect button so setup shows even while music plays
try {
  skipped = localStorage.getItem('skipSpotify') === '1'
} catch {
  /* storage unavailable */
}

/** Paint the left (elapsed) part of a range input green. */
function setFill(el: HTMLInputElement): void {
  const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100
  el.style.setProperty('--fill', `${pct}%`)
  if (el === volume) {
    const v = Number(el.value)
    $('vol-icon').className = v === 0 ? 'ri-volume-mute-line' : v < 40 ? 'ri-volume-down-line' : 'ri-volume-up-line'
  }
}

const viz = new Visualizer($<HTMLCanvasElement>('wave'), $<HTMLCanvasElement>('wave-radial'))

let update: PlayerUpdate | null = null
let dragging = false
let volumeDragging = false
/** Ignore volume echoed back by the player until this time, so stale reports don't yank the slider around mid-change */
let volumeHoldUntil = 0
const holdVolume = () => (volumeHoldUntil = Date.now() + 900)
let albumsOpen = false
let coverMode = false
let albumsLoaded = false

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Sets the text and, if it is wider than its box, makes it scroll back and forth so it can all be read */
function setMarquee(el: HTMLElement, text: string): void {
  const span = el.firstElementChild as HTMLElement
  if (span.textContent !== text) span.textContent = text
  fitMarquee(el)
}
function fitMarquee(el: HTMLElement): void {
  const span = el.firstElementChild as HTMLElement
  const over = span.scrollWidth - el.clientWidth
  const scroll = el.clientWidth > 0 && over > 1
  if (scroll) {
    el.style.setProperty('--shift', `${-Math.ceil(over)}px`)
    el.style.setProperty('--dur', `${Math.max(6, 4 + over / 25)}s`)
  }
  if (scroll !== el.classList.contains('scroll')) el.classList.toggle('scroll', scroll)
}
// The overlay is hidden outside cover mode and the window can be resized, so re-measure when its size changes
const marqueeObserver = new ResizeObserver((entries) => entries.forEach((e) => fitMarquee(e.target as HTMLElement)))
document.querySelectorAll<HTMLElement>('.marquee').forEach((el) => marqueeObserver.observe(el))

function render(u: PlayerUpdate): void {
  update = u
  if (u.auth === 'logged-in') forceSetup = false
  coverMode = u.cover
  document.body.classList.toggle('cover', u.cover)
  viz.radial = u.cover
  viz.scoped = u.scoped
  const needsSetup = u.auth !== 'logged-in' && (forceSetup || (!u.track && !skipped))
  if (needsSetup && u.cover) void api.setCover(false) // the setup form doesn't fit a square
  setup.hidden = !needsSetup
  player.hidden = needsSetup

  if (needsSetup) {
    const noId = u.auth === 'needs-client-id'
    clientInput.hidden = !noId
    setupMsg.textContent = u.error
      ? u.error
      : noId
        ? 'Paste your Spotify app Client ID (redirect URI: http://127.0.0.1:53682/callback)'
        : 'Connect your Spotify account'
    setupBtn.textContent = noId ? 'Save' : 'Connect Spotify'
    return
  }

  const t = u.track
  $('title').textContent = t?.title ?? 'Nothing playing'
  $('artist').textContent = t ? `${t.artist}${t.album ? ' - ' + t.album : ''}` : 'Open Spotify and press play'
  setMarquee($('cover-title'), t?.title ?? '')
  setMarquee($('cover-artist'), t?.artist ?? '')
  $('device').textContent = t
    ? [SOURCE_LABEL[t.source], t.deviceName].filter(Boolean).join(' - ')
    : 'Floating Music Player'
  $('btn-connect').hidden = u.auth === 'logged-in'
  // Only offer the button when browser media is playing without the extension; hide the help once it connects
  $('btn-extension').hidden = !u.extensionNeeded
  if (u.extension && !$('ext-help').hidden) toggleExtHelp(false)
  $('btn-albums').hidden = !(u.auth === 'logged-in' && (!t || t.canLibrary))
  if (albumsOpen && $('btn-albums').hidden) toggleAlbums(false)
  progress.disabled = !!t && !t.canSeek
  const playIcon = t?.isPlaying ? '<i class="ri-pause-fill"></i>' : '<i class="ri-play-fill"></i>'
  $('btn-play').innerHTML = playIcon
  $('cover-play').innerHTML = playIcon
  document.body.classList.toggle('idle', !t)
  $('btn-cover').innerHTML = `<i class="${u.cover ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'}"></i>`
  $('btn-cover').title = u.cover ? 'Back to player (F or Space)' : 'Cover mode (F or Space)'
  viz.playing = !!t?.isPlaying
  const red = !!t && t.source !== 'spotify' && t.source !== 'tidal'
  document.documentElement.dataset.source = t?.source ?? 'spotify'
  viz.colors = t?.source === 'tidal' ? ['#00d4ff', '#a6ecff'] : red ? ['#ff2d3f', '#ff9aa4'] : ['#1db954', '#8affb0']

  if (t?.imageUrl) {
    if (art.src !== t.imageUrl) art.src = t.imageUrl
    art.style.visibility = 'visible'
  } else {
    art.style.visibility = 'hidden'
  }
  if (t?.volume != null && !volumeDragging && Date.now() > volumeHoldUntil) volume.value = String(t.volume)
  volume.disabled = !t?.canVolume || t.volume == null
  volume.title = t && !t.canVolume ? `Volume can't be controlled for ${SOURCE_LABEL[t.source]}` : 'Volume'
  setFill(volume)

  errorEl.hidden = !u.error
  errorEl.textContent = u.error ?? ''
  errorEl.title = u.error ?? ''
}

/** Interpolate progress between polls so the bar moves smoothly. */
function currentProgress(t: TrackState): number {
  const elapsed = t.isPlaying ? Date.now() - t.sampledAt : 0
  return Math.min(t.durationMs, t.progressMs + elapsed)
}

function tick(): void {
  const t = update?.track
  if (t && !dragging && t.durationMs > 0) {
    progress.value = String(Math.round((currentProgress(t) / t.durationMs) * 1000))
    setFill(progress)
    progress.title = `${fmt(currentProgress(t))} / ${fmt(t.durationMs)}`
  }
  requestAnimationFrame(tick)
}

const PAGE_SIZE = 8 // 4 columns x 2 rows, fits the expanded window with no scrolling
let libraryItems: AlbumItem[] = []
let tab: AlbumItem['kind'] = 'album'
let page = 0

function renderAlbums(): void {
  const items = libraryItems.filter((i) => i.kind === tab)
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  page = Math.min(page, pages - 1)

  albumsEl.textContent = ''
  const bar = document.createElement('div')
  bar.className = 'album-bar'
  for (const [kind, label] of [['album', 'Albums'], ['playlist', 'Playlists']] as const) {
    const t = document.createElement('button')
    t.textContent = label
    t.className = kind === tab ? 'tab active' : 'tab'
    t.addEventListener('click', () => {
      tab = kind
      page = 0
      renderAlbums()
    })
    bar.append(t)
  }
  const pager = document.createElement('span')
  pager.className = 'pager'
  const prev = document.createElement('button')
  prev.innerHTML = '<i class="ri-arrow-left-s-line"></i>'
  prev.disabled = page === 0
  prev.addEventListener('click', () => {
    page--
    renderAlbums()
  })
  const count = document.createElement('span')
  count.textContent = `${page + 1}/${pages}`
  const nextBtn = document.createElement('button')
  nextBtn.innerHTML = '<i class="ri-arrow-right-s-line"></i>'
  nextBtn.disabled = page >= pages - 1
  nextBtn.addEventListener('click', () => {
    page++
    renderAlbums()
  })
  pager.append(prev, count, nextBtn)
  bar.append(pager)

  const grid = document.createElement('div')
  grid.className = 'album-grid'
  if (!items.length) grid.textContent = `No saved ${tab}s found.`
  for (const item of items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const b = document.createElement('div')
    b.className = 'album'
    b.title = `${item.name} - ${item.artist}`
    const img = document.createElement('img')
    if (item.imageUrl) img.src = item.imageUrl
    const label = document.createElement('span')
    label.textContent = item.name
    b.append(img, label)
    b.addEventListener('click', () => {
      void api.playContext(item.uri)
      toggleAlbums(false)
    })
    grid.append(b)
  }
  albumsEl.append(bar, grid)
}

async function loadAlbums(): Promise<void> {
  albumsEl.textContent = 'Loading...'
  libraryItems = await api.listLibrary()
  albumsLoaded = libraryItems.length > 0
  renderAlbums()
}

const extHelp = $('ext-help')

function toggleExtHelp(open: boolean): void {
  extHelp.hidden = !open
  if (open) albumsEl.hidden = true
  albumsOpen = false
  void api.setExpanded(open)
}

function toggleAlbums(open: boolean): void {
  if (open) extHelp.hidden = true
  albumsOpen = open
  albumsEl.hidden = !open
  void api.setExpanded(open)
  if (open && !albumsLoaded) void loadAlbums()
}

// Setup / login
setupBtn.addEventListener('click', async () => {
  if (update?.auth === 'needs-client-id') {
    if (clientInput.value.trim()) await api.setClientId(clientInput.value)
  } else {
    setupBtn.textContent = 'Waiting for browser...'
    await api.login()
  }
})

$('skip-btn').addEventListener('click', () => {
  skipped = true
  forceSetup = false
  try {
    localStorage.setItem('skipSpotify', '1')
  } catch {
    /* storage unavailable */
  }
  if (update) render(update)
})
$('btn-connect').addEventListener('click', () => {
  skipped = false
  forceSetup = true
  try {
    localStorage.removeItem('skipSpotify')
  } catch {
    /* storage unavailable */
  }
  if (update) render(update)
})

// Controls
$('btn-play').addEventListener('click', () => void api.togglePlay())
$('btn-next').addEventListener('click', () => void api.next())
$('btn-prev').addEventListener('click', () => void api.previous())
const BROWSER_NAME = {
  chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi', firefox: 'Firefox', unknown: 'your browser'
} as const

/** Runs the install helper (opens the browser + folder) and shows steps that match the browser. */
async function startExtensionInstall(): Promise<void> {
  const info = await api.installExtension()
  const steps: string[] =
    info.browser === 'firefox'
      ? [
          'On the page that opened, click <b>Load Temporary Add-on...</b>',
          'Pick <code>manifest.json</code> in the folder that just opened.',
          'Open the <b>Permissions</b> of the new add-on (about:addons) and allow access to YouTube sites.'
        ]
      : [
          info.opened
            ? `The ${BROWSER_NAME[info.browser]} extensions page just opened.`
            : `Open <code>${info.url ?? 'the extensions page of your browser'}</code> (copied - paste it in the address bar).`,
          'Turn on <b>Developer mode</b> (top right).',
          'Click <b>Load unpacked</b> and choose the folder that just opened.'
        ]
  $('ext-steps').innerHTML = steps.map((s) => `<li>${s}</li>`).join('')
  $('ext-note').textContent =
    info.browser === 'firefox'
      ? 'Firefox removes temporary add-ons when it restarts, so this needs repeating after a restart.'
      : 'This button disappears once the extension connects.'
}

$('btn-extension').addEventListener('click', () => {
  toggleExtHelp(true)
  void startExtensionInstall()
})
$('ext-open').addEventListener('click', () => void startExtensionInstall())
$('ext-close').addEventListener('click', () => toggleExtHelp(false))
$('btn-albums').addEventListener('click', () => toggleAlbums(!albumsOpen))
window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  void api.showMenu()
})
$('btn-quit').addEventListener('click', () => void api.quit())

progress.addEventListener('input', () => {
  dragging = true
  setFill(progress)
})
progress.addEventListener('change', () => {
  dragging = false
  const t = update?.track
  if (t) void api.seek((Number(progress.value) / 1000) * t.durationMs)
})

// Throttle volume calls so dragging doesn't hit Spotify's rate limit
let volumeTimer: number | undefined
const sendVolume = () => {
  window.clearTimeout(volumeTimer)
  volumeTimer = window.setTimeout(() => void api.setVolume(Number(volume.value)), 120)
}
volume.addEventListener('input', () => {
  volumeDragging = true
  holdVolume()
  setFill(volume)
  sendVolume()
})
volume.addEventListener('change', () => {
  volumeDragging = false
  holdVolume()
})

// Mouse wheel over the window adjusts volume
let volumeExact = 0
player.addEventListener('wheel', (e) => {
  if (volume.disabled) return
  // Scale by wheel delta (a notch is ~100) so trackpads and notched wheels both feel smooth
  const step = Math.max(-5, Math.min(5, -e.deltaY / 20))
  volumeExact = Math.max(0, Math.min(100, (Date.now() > volumeHoldUntil ? Number(volume.value) : volumeExact) + step))
  volume.value = String(Math.round(volumeExact))
  holdVolume()
  setFill(volume)
  sendVolume()
})

// Middle mouse click anywhere on the player toggles play/pause
player.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault() // suppress middle-click autoscroll
})
player.addEventListener('auxclick', (e) => {
  if (e.button === 1) void api.togglePlay()
})

// Cover mode
function toggleCover(): void {
  if (!coverMode) toggleAlbums(false)
  void api.setCover(!coverMode)
}
$('btn-cover').addEventListener('click', toggleCover)
// F or Space switches between the player and cover mode (not while typing, e.g. in the Client ID box)
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || player.hidden) return
  if (e.key !== 'f' && e.key !== 'F' && e.key !== ' ') return
  const el = e.target as HTMLElement
  if (el.closest('input:not([type=range]), textarea')) return
  e.preventDefault() // otherwise Space would also "click" whichever button has focus
  toggleCover()
})
$('cover-prev').addEventListener('click', () => void api.previous())
$('cover-play').addEventListener('click', () => void api.togglePlay())
$('cover-next').addEventListener('click', () => void api.next())

/** Drags the window (or resizes it from a corner) by streaming pointer deltas to the main process */
function startGesture(e: PointerEvent, kind: 'move' | 'nw' | 'ne' | 'sw' | 'se'): void {
  if (e.button !== 0) return
  e.preventDefault() // stops the browser starting a native image/selection drag, which would cancel this gesture
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const sx = e.screenX
  const sy = e.screenY
  let pending = false
  let last: [number, number] = [0, 0]
  void api.gestureStart(kind)
  const move = (m: PointerEvent) => {
    last = [m.screenX - sx, m.screenY - sy]
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      void api.gestureMove(...last)
    })
  }
  const end = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    void api.gestureMove(...last).then(() => api.gestureEnd())
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}
$('art-wrap').addEventListener('pointerdown', (e) => {
  if (coverMode && !(e.target as HTMLElement).closest('button, .handle')) startGesture(e, 'move')
})
document.querySelectorAll<HTMLElement>('.handle').forEach((h) => {
  h.addEventListener('pointerdown', (e) => startGesture(e, h.dataset.corner as 'nw' | 'ne' | 'sw' | 'se'))
})

api.onSpectrum((bins) => viz.feed(bins))
api.onUpdate(render)
void api.getUpdate().then(render)
requestAnimationFrame(tick)
