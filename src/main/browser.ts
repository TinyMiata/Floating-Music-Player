import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

export type BrowserKind = 'chrome' | 'edge' | 'brave' | 'opera' | 'vivaldi' | 'firefox' | 'unknown'

export interface DefaultBrowser {
  kind: BrowserKind
  exe: string | null
}

/** Where each browser lists its extensions. */
export const EXTENSIONS_URL: Record<BrowserKind, string | null> = {
  chrome: 'chrome://extensions',
  edge: 'edge://extensions',
  brave: 'brave://extensions',
  opera: 'opera://extensions',
  vivaldi: 'vivaldi://extensions',
  firefox: 'about:debugging#/runtime/this-firefox',
  unknown: null
}

export function kindFromProgId(progId: string): BrowserKind {
  if (/firefox/i.test(progId)) return 'firefox'
  if (/msedge|edge/i.test(progId)) return 'edge'
  if (/brave/i.test(progId)) return 'brave'
  if (/opera/i.test(progId)) return 'opera'
  if (/vivaldi/i.test(progId)) return 'vivaldi'
  if (/chrome/i.test(progId)) return 'chrome'
  return 'unknown'
}

/** Pulls the executable out of a shell command like: "C:\...\chrome.exe" --single-argument %1 */
export function exeFromCommand(cmd: string): string | null {
  const quoted = cmd.match(/"([^"]+\.exe)"/i)
  if (quoted) return quoted[1]
  const bare = cmd.match(/^\s*(\S+\.exe)/i)
  return bare ? bare[1] : null
}

async function regValue(key: string, name?: string): Promise<string | null> {
  try {
    const { stdout } = await run('reg', ['query', key, ...(name ? ['/v', name] : ['/ve'])], { windowsHide: true })
    const line = stdout.split(/\r?\n/).find((l) => /REG_\w+/.test(l))
    return line ? line.replace(/^\s*\S+\s+REG_\w+\s+/, '').trim() : null
  } catch {
    return null
  }
}

/** Reads the https handler the user picked in Windows "Default apps". */
export async function detectDefaultBrowser(): Promise<DefaultBrowser> {
  if (process.platform !== 'win32') return { kind: 'unknown', exe: null }
  const progId = await regValue(
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
    'ProgId'
  )
  if (!progId) return { kind: 'unknown', exe: null }
  const cmd = await regValue(`HKCR\\${progId}\\shell\\open\\command`)
  return { kind: kindFromProgId(progId), exe: cmd ? exeFromCommand(cmd) : null }
}

/** Opens a URL in a specific browser (needed because chrome:// pages can't go through the OS URL handler). */
export function openInBrowser(exe: string, url: string): void {
  spawn(exe, [url], { detached: true, stdio: 'ignore' }).unref()
}
