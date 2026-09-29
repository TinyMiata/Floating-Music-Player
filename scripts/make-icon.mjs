// Generates a green disc with dark equalizer bars.
// Run: node scripts/make-icon.mjs [size=256] [out=build/icon.png]
import { deflateSync } from 'zlib'
import { writeFileSync } from 'fs'

const N = Number(process.argv[2]) || 256
const OUT = process.argv[3] || 'build/icon.png'
const SS = 4 // supersampling for smooth edges
const bars = [ // [center x, half height] in 0..1 units
  [0.32, 0.14], [0.44, 0.26], [0.56, 0.2], [0.68, 0.1]
].map(([x, h]) => ({ x, h }))

function sample(u, v) {
  const dx = u - 0.5, dy = v - 0.5
  if (Math.hypot(dx, dy) > 0.48) return null
  for (const b of bars) if (Math.abs(u - b.x) < 0.04 && Math.abs(v - 0.5) < b.h) return [18, 18, 18]
  return [29, 185, 84]
}

const raw = Buffer.alloc(N * (N * 4 + 1))
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = sample((x + (sx + 0.5) / SS) / N, (y + (sy + 0.5) / SS) / N)
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++ }
    }
    const o = y * (N * 4 + 1) + 1 + x * 4
    const cnt = SS * SS
    raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = Math.round((a / cnt) * 255)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
writeFileSync(OUT, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]))
console.log(`wrote ${OUT}`)
