import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'

export interface Settings {
  clientId?: string
  windowX?: number
  windowY?: number
  opacity?: number
  ytmAnyBrowser?: boolean
  coverMode?: boolean
  coverSize?: number
  /** Scale of the normal player relative to its 380px base width */
  compactScale?: number
  /** Epoch ms until which Spotify's Web API has told us to stay away (429 Retry-After); survives restarts */
  spotifyRetryAfter?: number
}

const settingsPath = () => join(app.getPath('userData'), 'settings.json')
const tokenPath = () => join(app.getPath('userData'), 'tokens.bin')

export function loadSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Spotify Client ID: a value saved in settings wins, otherwise the one baked into the build
 * (MAIN_VITE_SPOTIFY_CLIENT_ID in .env). It identifies the app and is not a secret.
 */
export function getClientId(): string | undefined {
  return loadSettings().clientId || import.meta.env.MAIN_VITE_SPOTIFY_CLIENT_ID || undefined
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
  return next
}

export interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export function loadTokens(): Tokens | null {
  try {
    if (!existsSync(tokenPath())) return null
    const raw = readFileSync(tokenPath())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function saveTokens(t: Tokens): void {
  const json = JSON.stringify(t)
  writeFileSync(tokenPath(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : json)
}

export function clearTokens(): void {
  try {
    unlinkSync(tokenPath())
  } catch {
    /* already gone */
  }
}
