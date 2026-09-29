import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { BrowserBridge } from './bridge'

// Not the real port, so the test still runs while the installed app is open
const PORT = 53999
const url = `ws://127.0.0.1:${PORT}`
const open = (origin?: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, { origin })
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    ws.on('unexpected-response', () => reject(new Error('rejected')))
  })

describe('BrowserBridge', () => {
  let bridge: BrowserBridge
  beforeAll(() => {
    bridge = new BrowserBridge(() => undefined, PORT)
    bridge.start()
  })
  afterAll(() => bridge.stop())

  it('rejects connections that are not from a browser extension', async () => {
    await expect(open('https://evil.example')).rejects.toBeDefined()
    expect(bridge.connected).toBe(false)
  })

  it('stores tab state and relays commands back to the extension', async () => {
    const ws = await open('chrome-extension://abcdef')
    const got = new Promise<any>((resolve) => ws.on('message', (d) => resolve(JSON.parse(d.toString()))))
    ws.send(JSON.stringify({ type: 'state', tabId: 7, site: 'ytmusic', title: 'Song', artist: 'A - Topic', playing: true, posMs: 1000, durMs: 5000, volume: 40 }))
    await new Promise((r) => setTimeout(r, 100))

    expect(bridge.connected).toBe(true)
    expect(bridge.liveTabs()).toMatchObject([{ tabId: 7, site: 'ytmusic', title: 'Song', volume: 40, playing: true }])

    bridge.send(7, 'volume', 25)
    expect(await got).toEqual({ type: 'cmd', tabId: 7, cmd: 'volume', value: 25 })

    ws.send(JSON.stringify({ type: 'gone', tabId: 7 }))
    await new Promise((r) => setTimeout(r, 100))
    expect(bridge.liveTabs()).toEqual([])
    ws.close()
  })
})
