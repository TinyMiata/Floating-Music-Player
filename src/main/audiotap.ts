import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import script from './audiotap.ps1?raw'

/**
 * Captures the audio of specific apps only (WASAPI process loopback, via a PowerShell helper) and reports a
 * 128-bin spectrum, so the visualizer ignores everything else the PC is playing.
 */
export class AudioTap {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private names: string[] = []
  private wasSilent = false

  constructor(private onSpectrum: (bins: Buffer) => void) {}

  /** Executable names (e.g. Spotify.exe) whose audio to capture; an empty list stops the helper */
  setTargets(names: string[]): void {
    if (names.join(',') === this.names.join(',')) return
    this.names = names
    this.proc?.kill()
    this.proc = null
    if (names.length) this.spawnHelper()
  }

  stop(): void {
    this.names = []
    this.proc?.kill()
    this.proc = null
  }

  private spawnHelper(): void {
    if (process.platform !== 'win32') return
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'audiotap.ps1')
    writeFileSync(file, script, 'utf8')

    const names = this.names
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-Names', names.join(',')],
      { windowsHide: true }
    )
    this.proc = proc
    this.buffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    proc.on('exit', () => {
      if (this.proc !== proc) return // replaced or stopped on purpose
      this.proc = null
      if (this.names.length) setTimeout(() => this.names.length && !this.proc && this.spawnHelper(), 3000)
    })
    proc.on('error', () => undefined)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let i: number
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim()
      this.buffer = this.buffer.slice(i + 1)
      if (!line.startsWith('S ')) continue
      const bins = Buffer.from(line.slice(2), 'base64')
      const silent = !bins.some((v) => v > 0)
      // The page treats a missing frame as silence, so there is no need to send them back to back
      if (silent && this.wasSilent) continue
      this.wasSilent = silent
      this.onSpectrum(bins)
    }
  }
}
