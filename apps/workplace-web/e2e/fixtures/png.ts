// 테스트용 단색 PNG 생성 (WP-234).
// 1×1 PNG 는 128px 스켈레톤보다 작아 "썸네일이 늦게 커질 때도 하단 고정" 같은 높이 증가 경로를 재현하지 못한다.
// 이미지 라이브러리 없이 zlib 만으로 원하는 크기의 실제 PNG 를 만들어 썸네일 원본 응답에 쓴다.
import { Buffer } from 'buffer'
import { deflateSync } from 'zlib'

/** CRC-32(IEEE) — PNG 청크 무결성 값. */
function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** 길이·타입·데이터·CRC 로 PNG 청크 하나를 만든다. */
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** width×height 단색 RGB PNG. rgb 기본값은 중간 회색. */
export function solidPng(width: number, height: number, rgb: [number, number, number] = [128, 128, 128]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 비트 깊이
  ihdr[9] = 2 // 색 형식: RGB
  // 각 행 = 필터 바이트(0) + 픽셀 RGB.
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
