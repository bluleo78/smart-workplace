// 공유 이미지 테스트가 함께 쓰는 최소 PNG 디코더(og-image.test.mjs·share-cards.test.mjs) — 8비트 RGB/RGBA·비인터레이스만 읽는다.
import { inflateSync } from 'node:zlib'

/** Teams 가 가운데 잘림으로 남기는 가로 범위(x 202~998) — 그 밖에는 배경만 있어야 한다. */
export const KEEP_LEFT = 202
export const KEEP_RIGHT = 998

/** 기본 배경색 — 브랜드 인디고(#4338ca). */
export const BACKGROUND = [0x43, 0x38, 0xca]

/** 8비트 RGB/RGBA·비인터레이스 PNG 를 픽셀 배열로 푼다 — 테스트 전용 최소 디코더(필터 0~4). */
export function decodePng(buf, background = BACKGROUND) {
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
    return (
      Math.abs(out[o] - background[0]) <= 2 &&
      Math.abs(out[o + 1] - background[1]) <= 2 &&
      Math.abs(out[o + 2] - background[2]) <= 2
    )
  }
  return { width, height, isBackground }
}
