// Runs on YouTube / YouTube Music / Tidal pages: reports playback state and executes commands.
;(() => {
  const site = /tidal\.com$/.test(location.hostname) ? 'tidal' : location.hostname === 'music.youtube.com' ? 'ytmusic' : 'youtube'
  const video = () => document.querySelector('video, audio')
  const click = (sel) => {
    const el = document.querySelector(sel)
    if (el) el.click()
    return !!el
  }

  function isWatchPage() {
    return site === 'ytmusic' || site === 'tidal' || location.pathname.startsWith('/watch') || location.pathname.startsWith('/shorts')
  }

  function snapshot() {
    const v = video()
    if (!v || !isWatchPage() || !v.currentSrc) return null
    const md = navigator.mediaSession && navigator.mediaSession.metadata
    const videoId = new URL(location.href).searchParams.get('v') || ''
    const artwork = md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : ''
    const title = (md && md.title) || document.title.replace(/ - YouTube( Music)?$/, '')
    if (!title) return null
    return {
      type: 'state',
      site,
      title,
      artist: (md && md.artist) || '',
      album: (md && md.album) || '',
      videoId,
      imageUrl: artwork || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''),
      playing: !v.paused && !v.ended,
      posMs: Math.round(v.currentTime * 1000),
      durMs: isFinite(v.duration) ? Math.round(v.duration * 1000) : 0,
      volume: Math.round((v.muted ? 0 : v.volume) * 100)
    }
  }

  function tick() {
    try {
      const s = snapshot()
      if (s) chrome.runtime.sendMessage(s).catch(() => {})
    } catch {
      /* extension was reloaded; this script is stale */
    }
  }
  setInterval(tick, 500)

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'cmd') return
    const v = video()
    if (!v) return
    switch (msg.cmd) {
      case 'toggle':
        v.paused ? v.play() : v.pause()
        break
      case 'seek':
        v.currentTime = Number(msg.value) / 1000
        break
      case 'volume':
        v.muted = false
        v.volume = Math.max(0, Math.min(1, Number(msg.value) / 100))
        break
      case 'next':
        click(site === 'tidal' ? '[data-test="next"]' : site === 'ytmusic' ? 'ytmusic-player-bar .next-button' : '.ytp-next-button')
        break
      case 'prev':
        if (!click(site === 'tidal' ? '[data-test="previous"]' : site === 'ytmusic' ? 'ytmusic-player-bar .previous-button' : '.ytp-prev-button')) v.currentTime = 0
        break
    }
    setTimeout(tick, 100)
  })

  window.addEventListener('pagehide', () => {
    try {
      chrome.runtime.sendMessage({ type: 'state', site, gone: true }).catch(() => {})
    } catch {
      /* ignore */
    }
  })
})()
