// src/lib/push/keys.test.ts
// urlBase64ToBytes/sameApplicationServerKey 단위 테스트 — 서버 VAPID 키 비교 로직이 핵심.
import { describe, expect, it } from 'vitest'

import { sameApplicationServerKey, urlBase64ToBytes } from './keys'

// 65바이트(0x04 + 64바이트 0) 를 base64url 로 — 'B' + 'A'*86
const KEY = 'B' + 'A'.repeat(86)

describe('urlBase64ToBytes', () => {
  it('패딩 없는 base64url 디코드', () => {
    const b = urlBase64ToBytes(KEY)
    expect(b.length).toBe(65)
    expect(b[0]).toBe(4)
  })
  it('-_ 문자 처리', () => {
    expect(Array.from(urlBase64ToBytes('-_8'))).toEqual([251, 255])
  })
})

describe('sameApplicationServerKey', () => {
  it('같은 키면 true(ArrayBuffer·Uint8Array 모두)', () => {
    const b = urlBase64ToBytes(KEY)
    expect(sameApplicationServerKey(b, KEY)).toBe(true)
    expect(sameApplicationServerKey(b.buffer.slice(0), KEY)).toBe(true)
  })
  it('다르거나 없으면 false', () => {
    const other = urlBase64ToBytes('B' + 'A'.repeat(85) + 'E')
    expect(sameApplicationServerKey(other, KEY)).toBe(false)
    expect(sameApplicationServerKey(null, KEY)).toBe(false)
  })
})
