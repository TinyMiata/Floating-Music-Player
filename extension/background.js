// Relays between the content scripts (YouTube tabs) and the desktop app's local WebSocket.
// The socket lives here rather than in the page because YouTube's CSP would block it.
const APP_URL = 'ws://127.0.0.1:53683'
let ws = null

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
  try {
    ws = new WebSocket(APP_URL)
  } catch {
    ws = null
    return
  }
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello' }))
  ws.onmessage = (e) => {
    let msg
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (msg.type === 'cmd' && typeof msg.tabId === 'number') {
      chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {})
    }
  }
  ws.onclose = () => {
    ws = null
  }
  ws.onerror = () => {}
}

function send(obj) {
  connect()
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.tab && msg && msg.type === 'state') send({ ...msg, tabId: sender.tab.id })
})
chrome.tabs.onRemoved.addListener((tabId) => send({ type: 'gone', tabId }))

// Keep the worker alive (traffic on an open socket resets Chrome's idle timer) and reconnect
// whenever the app was not running.
connect()
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
  else connect()
}, 15000)
chrome.alarms.create('reconnect', { periodInSeconds: 30 })
chrome.alarms.onAlarm.addListener(connect)
