# Floating Music Player

## Icons

- Always use Remix Icon (`remixicon`, classes like `<i class="ri-play-fill"></i>`) for every icon in the UI.
- Never use text glyphs, Unicode symbols or emoji as icons (no `&#9654;`, `▶`, `☰`, `×`, `‹`, `🔊`, etc.). They render inconsistently and can't be styled.
- Set icons from `main.ts` with an `<i class="ri-...">` element, not by writing a glyph into `textContent`.
- The font is imported in `src/renderer/main.ts`. `electron.vite.config.ts` trims it to woff2 only, so don't add other font formats.
- Icon names: https://remixicon.com
