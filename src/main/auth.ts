import { createServer } from 'http'
import { createHash, randomBytes } from 'crypto'
import { shell } from 'electron'
import { getClientId, loadTokens, saveTokens, type Tokens } from './config'

export const REDIRECT_PORT = 53682
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'playlist-read-private'
].join(' ')

const b64url = (b: Buffer) => b.toString('base64url')

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  })
  if (!res.ok) throw new Error(`Token request failed (${res.status})`)
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? body.refresh_token,
    expiresAt: Date.now() + j.expires_in * 1000 - 30_000
  }
}

export async function login(): Promise<Tokens> {
  const clientId = getClientId()
  if (!clientId) throw new Error('Missing Spotify client ID')

  const verifier = b64url(randomBytes(64))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const got = url.searchParams.get('code')
      const ok = !err && got && url.searchParams.get('state') === state
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<body style="font-family:sans-serif;background:#121212;color:#fff;text-align:center;padding-top:20vh">
        <h2>${ok ? 'Connected! You can close this tab.' : 'Authorization failed.'}</h2></body>`)
      clearTimeout(timer)
      server.close()
      ok ? resolve(got) : reject(new Error(err ?? 'State mismatch'))
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Login timed out'))
    }, 5 * 60_000)
    server.on('error', reject)
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state,
        code_challenge_method: 'S256',
        code_challenge: challenge
      })
      shell.openExternal(`https://accounts.spotify.com/authorize?${params}`)
    })
  })

  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier
  })
  saveTokens(tokens)
  return tokens
}

export async function getAccessToken(): Promise<string | null> {
  const clientId = getClientId()
  let tokens = loadTokens()
  if (!tokens || !clientId) return null
  if (Date.now() >= tokens.expiresAt) {
    tokens = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId
    })
    saveTokens(tokens)
  }
  return tokens.accessToken
}
