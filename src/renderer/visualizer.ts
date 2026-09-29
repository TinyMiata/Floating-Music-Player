/** Draws a live frequency-bar visualizer from system audio (WASAPI loopback). */
export class Visualizer {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private data = new Uint8Array(0)
  private raf = 0
  private phase = 0
  playing = false
  /** [bottom, top] gradient colors */
  colors: [string, string] = ['#1db954', '#8affb0']

  constructor(private canvas: HTMLCanvasElement) {
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
    void this.connect()
  }

  private async connect(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      stream.getVideoTracks().forEach((t) => t.stop())
      if (!stream.getAudioTracks().length) return
      this.ctx = new AudioContext()
      const src = this.ctx.createMediaStreamSource(stream)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = 0.75
      src.connect(this.analyser) // not connected to destination: no echo
      this.data = new Uint8Array(this.analyser.frequencyBinCount)
    } catch {
      /* fall back to the synthetic animation */
    }
  }

  private loop(): void {
    const { canvas } = this
    const g = canvas.getContext('2d')!
    const w = canvas.width
    const h = canvas.height
    g.clearRect(0, 0, w, h)

    const bars = 48
    const gap = 2
    const bw = (w - gap * (bars - 1)) / bars
    this.phase += 0.08
    if (this.analyser) this.analyser.getByteFrequencyData(this.data)

    const grad = g.createLinearGradient(0, h, 0, 0)
    grad.addColorStop(0, this.colors[0])
    grad.addColorStop(1, this.colors[1])
    g.fillStyle = grad

    for (let i = 0; i < bars; i++) {
      let v: number
      if (this.analyser && this.data.length) {
        // use lower ~70% of the spectrum, where music energy lives
        const idx = Math.floor((i / bars) * this.data.length * 0.7)
        v = this.data[idx] / 255
      } else {
        v = this.playing ? 0.25 + 0.2 * Math.sin(this.phase + i * 0.5) * Math.sin(this.phase * 0.7 + i) : 0
      }
      const bh = Math.max(2, v * h)
      g.beginPath()
      g.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, 1.5)
      g.fill()
    }
    this.raf = requestAnimationFrame(this.loop)
  }
}
