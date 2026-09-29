import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import script from './smtc.ps1?raw'
import type { MediaSession } from './classify'

type Listener = (sessions: MediaSession[]) => void

/** Bridges to Windows media sessions through a long-running PowerShell helper. */
export class SmtcBridge {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private thumbs = new Map<string, { key: string; thumb: string }>()
  private stopped = false

  constructor(private onSessions: Listener) {}

  start(): void {
    if (process.platform !== 'win32') return
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'smtc.ps1')
    writeFileSync(file, script, 'utf8')

    this.proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { windowsHide: true }
    )
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.proc.on('exit', () => {
      this.proc = null
      if (!this.stopped) setTimeout(() => this.start(), 3000)
    })
    this.proc.on('error', () => undefined)
  }

  stop(): void {
    this.stopped = true
    this.proc?.kill()
  }

  send(cmd: 'toggle' | 'next' | 'prev' | 'seek', appId: string, arg?: number): void {
    this.proc?.stdin.write([cmd, appId, arg].filter((x) => x !== undefined).join('|') + '\n')
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let i: number
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim()
      this.buffer = this.buffer.slice(i + 1)
      if (!line.startsWith('{')) continue
      try {
        const { sessions } = JSON.parse(line) as { sessions: MediaSession[] }
        this.onSessions(sessions.map((s) => this.withThumb(s)))
      } catch {
        /* partial or malformed line */
      }
    }
  }

  /** The helper sends artwork once per track; remember it until the track changes. */
  private withThumb(s: MediaSession): MediaSession {
    if (s.thumb) this.thumbs.set(s.id, { key: s.key, thumb: s.thumb })
    const cached = this.thumbs.get(s.id)
    return { ...s, thumb: cached && cached.key === s.key ? cached.thumb : undefined }
  }
}
