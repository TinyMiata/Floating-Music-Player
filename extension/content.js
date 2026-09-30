// Runs on YouTube / YouTube Music / Tidal pages: reports playback state and executes commands.
;(() => {
  const site = /tidal\.com$/.test(location.hostname) ? 'tidal' : location.hostname === 'music.youtube.com' ? 'ytmusic' : 'youtube'
  const video = () => document.querySelector('video, audio')
  const click = (sel) => {
    const el = document.querySelector(sel)
    if (el) el.click()
    return !!el
  }

  // Volume is ramped rather than jumped, so slider drags don't step/click and playback starts with a short fade-in.
  let target = null // the volume the user wants (0..1); the element's volume chases it
  let applied = null // last value we wrote, to tell our own changes from the page's
  let ramp = 0
  function rampTo(v, goal, ms) {
    clearInterval(ramp)
    const step = 10
    const from = v.volume
    const n = Math.max(1, Math.round(ms / step))
    let i = 0
    ramp = setInterval(() => {
      i++
      applied = i >= n ? goal : from + (goal - from) * (i / n)
      v.volume = Math.max(0, Math.min(1, applied))
      if (i >= n) clearInterval(ramp)
    }, step)
  }
  function watch(v) {
    if (v.__fmpWatched) return
    v.__fmpWatched = true
    // Adopt volume changes made on the page itself
    v.addEventListener('volumechange', () => {
      if (applied === null || Math.abs(v.volume - applied) > 0.001) {
        target = v.volume
        applied = v.volume
      }
    })
    // Fade in from silence so tracks that start loud don't pop
    v.addEventListener('playing', () => {
      const goal = target ?? v.volume
      target = goal
      v.volume = applied = 0
      rampTo(v, goal, 150)
    })
  }

  function isWatchPage() {
    return site === 'ytmusic' || site === 'tidal' || location.pathname.startsWith('/watch') || location.pathname.startsWith('/shorts')
  }

  function shareUrl(videoId) {
    if (site === 'youtube' && videoId) return `https://youtu.be/${videoId}`
    if (site === 'ytmusic' && videoId) return `https://music.youtube.com/watch?v=${videoId}`
    return location.href
  }

  function snapshot() {
    const v = video()
    if (v) watch(v)
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
      url: shareUrl(videoId),
      imageUrl: artwork || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''),
      playing: !v.paused && !v.ended,
      posMs: Math.round(v.currentTime * 1000),
      durMs: isFinite(v.duration) ? Math.round(v.duration * 1000) : 0,
      volume: Math.round((v.muted ? 0 : (target ?? v.volume)) * 100)
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
        target = Math.max(0, Math.min(1, Number(msg.value) / 100))
        rampTo(v, target, 80)
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
