/** Draws a live visualizer from system audio (WASAPI loopback): flat bars in the player, a ring around the cover in cover mode. */
export class Visualizer {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private data = new Uint8Array(0)
  private raf = 0
  private phase = 0
  private stream: MediaStream | null = null
  private connecting = false
  private lastAttempt = 0
  private silentFrames = 0
  playing = false
  /** Draw the radial ring on the cover canvas instead of the flat bars */
  radial = false
  /** [bottom, top] gradient colors */
  colors: [string, string] = ['#1db954', '#8affb0']

  constructor(
    private canvas: HTMLCanvasElement,
    private radialCanvas: HTMLCanvasElement
  ) {
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
    void this.connect()
    // Loopback capture is bound to the output device that was default when it started, so re-attach when devices change
    let timer: number | undefined
    navigator.mediaDevices.addEventListener('devicechange', () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void this.connect(), 800)
    })
  }

  private teardown(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.stream = null
    this.ctx = null
    this.analyser = null
    this.data = new Uint8Array(0)
  }

  private async connect(): Promise<void> {
    if (this.connecting) return
    this.connecting = true
    this.lastAttempt = Date.now()
    this.silentFrames = 0
    this.teardown()
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      stream.getVideoTracks().forEach((t) => t.stop())
      if (!stream.getAudioTracks().length) return
      this.stream = stream
      stream.getAudioTracks()[0].addEventListener('ended', () => void this.connect())
      this.ctx = new AudioContext()
      const src = this.ctx.createMediaStreamSource(stream)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = 0.75
      src.connect(this.analyser) // not connected to destination: no echo
      this.data = new Uint8Array(this.analyser.frequencyBinCount)
    } catch {
      /* fall back to the synthetic animation */
    } finally {
      this.connecting = false
    }
  }

  /** Reconnects when capture is missing, or stays silent while music plays (e.g. the output device was swapped) */
  private watchdog(): void {
    if (this.connecting || Date.now() - this.lastAttempt < 5000) return
    if (!this.analyser) {
      if (this.playing) void this.connect()
      return
    }
    if (!this.playing) return void (this.silentFrames = 0)
    this.silentFrames = this.data.some((v) => v > 0) ? 0 : this.silentFrames + 1
    if (this.silentFrames > 180) void this.connect() // ~3 s of nothing
  }

  /** Spectrum value 0..1 for bar i of n, or a synthetic wobble while no audio is being captured */
  private level(i: number, n: number): number {
    if (this.analyser && this.data.length) {
      // use lower ~70% of the spectrum, where music energy lives
      return this.data[Math.floor((i / n) * this.data.length * 0.7)] / 255
    }
    return this.playing ? 0.25 + 0.2 * Math.sin(this.phase + i * 0.5) * Math.sin(this.phase * 0.7 + i) : 0
  }

  private drawBars(): void {
    const { canvas } = this
    const g = canvas.getContext('2d')!
    const w = canvas.width
    const h = canvas.height
    g.clearRect(0, 0, w, h)

    const bars = 48
    const gap = 2
    const bw = (w - gap * (bars - 1)) / bars
    const grad = g.createLinearGradient(0, h, 0, 0)
    grad.addColorStop(0, this.colors[0])
    grad.addColorStop(1, this.colors[1])
    g.fillStyle = grad

    for (let i = 0; i < bars; i++) {
      const bh = Math.max(2, this.level(i, bars) * h)
      g.beginPath()
      g.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, 1.5)
      g.fill()
    }
  }

  private drawRadial(): void {
    const c = this.radialCanvas
    const dpr = window.devicePixelRatio || 1
    const size = Math.round(c.clientWidth * dpr)
    if (c.width !== size || c.height !== Math.round(c.clientHeight * dpr)) {
      c.width = size
      c.height = Math.round(c.clientHeight * dpr)
    }
    const g = c.getContext('2d')!
    const w = c.width
    const h = c.height
    g.clearRect(0, 0, w, h)
    if (!w || !h) return

    const cx = w / 2
    const cy = h / 2
    const m = Math.min(w, h)
    const inner = m * 0.36 // keeps the middle of the cover clear
    const reach = m * 0.13 // how far a full-scale bar extends beyond the inner ring
    const bars = 64 // mirrored left/right, so 32 distinct spectrum bins
    const half = bars / 2
    g.lineWidth = Math.max(2, (2 * Math.PI * inner) / bars - 2 * dpr)
    // White here; the canvas' CSS mix-blend-mode: difference turns it into the inverse of the art beneath
    g.strokeStyle = '#fff'
    g.lineCap = 'round'
    for (let i = 0; i < bars; i++) {
      // bass at the bottom, mirrored up both sides
      const k = i < half ? i : bars - 1 - i
      const a = Math.PI / 2 + ((i + 0.5) / bars) * Math.PI * 2
      const len = Math.max(2 * dpr, this.level(k, half) * reach)
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      g.beginPath()
      g.moveTo(cx + cos * inner, cy + sin * inner)
      g.lineTo(cx + cos * (inner + len), cy + sin * (inner + len))
      g.stroke()
    }
  }

  private loop(): void {
    this.phase += 0.08
    if (this.analyser) this.analyser.getByteFrequencyData(this.data)
    this.watchdog()
    if (this.radial) this.drawRadial()
    else this.drawBars()
    this.raf = requestAnimationFrame(this.loop)
  }
}
