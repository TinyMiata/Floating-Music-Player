import { contextBridge, ipcRenderer } from 'electron'
import type { FloatingApi, PlayerUpdate } from '../shared/types'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: FloatingApi = {
  getUpdate: () => invoke('player:get'),
  onUpdate: (cb) => {
    const handler = (_: unknown, u: PlayerUpdate) => cb(u)
    ipcRenderer.on('player:update', handler)
    return () => ipcRenderer.removeListener('player:update', handler)
  },
  setClientId: (id) => invoke('auth:client-id', id),
  login: () => invoke('auth:login'),
  logout: () => invoke('auth:logout'),
  togglePlay: () => invoke('player:toggle'),
  next: () => invoke('player:next'),
  previous: () => invoke('player:previous'),
  setVolume: (p) => invoke('player:volume', p),
  seek: (ms) => invoke('player:seek', ms),
  copyLink: () => invoke('player:copy-link'),
  showMenu: () => invoke('player:menu'),
  listLibrary: () => invoke('library:list'),
  playContext: (uri) => invoke('library:play', uri),
  setExpanded: (e) => invoke('window:expand', e),
  setOpacity: (v) => invoke('window:opacity', v),
  showSetup: () => invoke('auth:show-setup'),
  installExtension: () => invoke('ext:install'),
  quit: () => invoke('app:quit')
}

contextBridge.exposeInMainWorld('api', api)
