// Builds release/floating-music-player-firefox-<version>.zip for upload to addons.mozilla.org.
// Run: npm run pack:firefox
// Writes the zip directly (deflate + CRC32) so it doesn't depend on whichever `tar`/`zip` is on PATH.
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { deflateRawSync } from 'zlib'
import { join } from 'path'

// Version in the name: AMO needs a higher version per upload, and the browser may lock an older zip
const { version } = JSON.parse(readFileSync(join('extension', 'manifest.firefox.json'), 'utf8'))
const OUT = join('release', `floating-music-player-firefox-${version}.zip`)

// [name inside zip, source file]. Firefox needs its own manifest at the top level.
const files = [
  ['manifest.json', join('extension', 'manifest.firefox.json')],
  ['background.js', join('extension', 'background.js')],
  ['content.js', join('extension', 'content.js')],
  ['icon.png', join('extension', 'icon.png')]
]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const now = new Date()
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

const parts = []
const central = []
let offset = 0

for (const [name, src] of files) {
  const data = readFileSync(src)
  const compressed = deflateRawSync(data)
  const nameBuf = Buffer.from(name)
  const crc = crc32(data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0x0800, 6) // UTF-8 names
  local.writeUInt16LE(8, 8) // deflate
  local.writeUInt16LE(dosTime, 10)
  local.writeUInt16LE(dosDate, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  parts.push(local, nameBuf, compressed)

  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(20, 4) // made by
  cd.writeUInt16LE(20, 6) // version needed
  cd.writeUInt16LE(0x0800, 8)
  cd.writeUInt16LE(8, 10)
  cd.writeUInt16LE(dosTime, 12)
  cd.writeUInt16LE(dosDate, 14)
  cd.writeUInt32LE(crc, 16)
  cd.writeUInt32LE(compressed.length, 20)
  cd.writeUInt32LE(data.length, 24)
  cd.writeUInt16LE(nameBuf.length, 28)
  cd.writeUInt32LE(offset, 42)
  central.push(cd, nameBuf)

  offset += local.length + nameBuf.length + compressed.length
}

const centralBuf = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralBuf.length, 12)
end.writeUInt32LE(offset, 16)

mkdirSync('release', { recursive: true })
writeFileSync(OUT, Buffer.concat([...parts, centralBuf, end]))
console.log(`wrote ${OUT}`)
