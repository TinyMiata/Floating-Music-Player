# Floating Music Player

An always-on-top Windows mini-player that shows what you're playing on **Spotify**, **Tidal** or **YouTube / YouTube Music**, with a live soundwave, progress and volume sliders, play/pause/next/previous, and a quick album/playlist picker (Spotify).

## How it gets its data
- **Spotify Web API** (Premium): now playing, controls, volume, saved albums and playlists.
- **Windows media sessions (SMTC)**: any app that reports to Windows, no login needed. This is how the Tidal desktop app is picked up.
- **Browser extension** (`extension/`): exact track info, volume and seek for YouTube, YouTube Music and the Tidal web player (listen.tidal.com) in Chrome-family browsers and Firefox.

## Development
```
npm install
cp .env.example .env    # add your Spotify Client ID
npm run dev
```
Create a Spotify app at https://developer.spotify.com/dashboard with the redirect URI `http://127.0.0.1:53682/callback`.

```
npm test               # unit tests
npm run dist           # Windows installer
npm run pack:firefox   # zip of the Firefox extension for addons.mozilla.org
```

## Browser extension
Click the puzzle button in the app when browser media is playing without the extension connected; it opens your default browser's extensions page and the extension folder. Chrome/Edge/Brave: Developer mode, then Load unpacked. Firefox: Load Temporary Add-on (or install the signed build).
