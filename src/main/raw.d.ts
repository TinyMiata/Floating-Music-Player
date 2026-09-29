/// <reference types="electron-vite/node" />

declare module '*?raw' {
  const content: string
  export default content
}

interface ImportMetaEnv {
  readonly MAIN_VITE_SPOTIFY_CLIENT_ID?: string
}
