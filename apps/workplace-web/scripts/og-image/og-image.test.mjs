// 공유 이미지(public/og-image.png)가 Teams 의 가운데 잘림을 견디는지 지킨다(WP-1224).
// Teams 는 1200×630 이미지를 썸네일 칸(약 1.26:1)에 가운데 기준으로 잘라 x 202~998 만 남긴다 — 그 밖에는 배경만 있어야 한다.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const BACKGROUND = [0x43, 0x38, 0xca]
const KEEP_LEFT = 202
const KEEP_RIGHT = 998

/** 8비트 RGB/RGBA·비인터레이스 PNG 를 픽셀 배열로 푼다 — 테스트 전용 최소 디코더(필터 0~4). */
function decodePng(buf) {
  let pos = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('8비트 비인터레이스 PNG 만 읽는다')
      channels = { 2: 3, 6: 4 }[data[9]]
      if (!channels) throw new Error(`지원하지 않는 색 형식 ${data[9]}`)
    } else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error(`${y}행의 필터 값 ${filter} 이 잘못됐다 — 깨진 PNG`)
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x]
      const a = x >= channels ? out[y * stride + x - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]
      out[y * stride + x] = (cur + predictor) & 0xff
    }
  }
  /** (x, y) 가 배경색(±2)인가 — 픽셀마다 배열을 만들지 않고 바이트를 바로 비교한다. */
  const isBackground = (x, y) => {
    const o = y * stride + x * channels
    return BACKGROUND.every((v, i) => Math.abs(out[o + i] - v) <= 2)
  }
  return { width, height, isBackground }
}

describe('og-image.png', () => {
  const img = decodePng(readFileSync(new URL('../../public/og-image.png', import.meta.url)))

  it('1200×630 이다', () => {
    expect([img.width, img.height]).toEqual([1200, 630])
  })

  it('Teams 가 잘라 내는 좌우(x < 202, x > 998)에는 배경만 있고 내용은 남는 가운데에 있다', () => {
    const outside = []
    let inside = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const bg = img.isBackground(x, y)
        if (x < KEEP_LEFT || x > KEEP_RIGHT) {
          if (!bg) outside.push([x, y])
        } else if (!bg) inside++
      }
    }
    expect(outside.slice(0, 5)).toEqual([])
    expect(inside).toBeGreaterThan(10000)
  })
})
