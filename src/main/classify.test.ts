import { describe, expect, it } from 'vitest'
import { classify } from './classify'

const s = (id: string, album = '', artist = 'X') => ({ id, album, artist })

describe('classify', () => {
  it('detects Spotify desktop', () => expect(classify(s('Spotify.exe'))).toBe('spotify'))
  it('detects the YouTube Music desktop app', () => expect(classify(s('th-ch.YoutubeMusic'))).toBe('ytmusic'))
  it('detects a browser song by its album', () => expect(classify(s('chrome.exe', 'Album'))).toBe('ytmusic'))
  it('detects a Topic artist channel', () => expect(classify(s('msedge.exe', '', 'Daft Punk - Topic'))).toBe('ytmusic'))
  it('labels plain browser video as generic media', () => expect(classify(s('chrome.exe'))).toBe('media'))
  it('detects a hashed browser id with an album', () => expect(classify(s('F0DC299D809B9700', 'Album'))).toBe('ytmusic'))
  it('treats a hashed browser id as YT Music when asked', () => expect(classify(s('F0DC299D809B9700'), true)).toBe('ytmusic'))
  it('treats any browser media as YT Music when asked', () => expect(classify(s('chrome.exe'), true)).toBe('ytmusic'))
  it('labels other apps as generic media', () => expect(classify(s('vlc.exe', 'Album'))).toBe('media'))
})
