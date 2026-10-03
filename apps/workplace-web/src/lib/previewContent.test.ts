import { describe, expect, it } from 'vitest'

import { decodeTextBuffer, hasPdfMagicBytes } from './previewContent'

// '한글' 의 EUC-KR(CP949) 바이트 — 한국어 Windows 엑셀 "CSV (쉼표로 분리)" 저장 형식.
const HANGUL_EUC_KR = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb])

describe('decodeTextBuffer', () => {
  it('UTF-8 은 그대로 디코딩한다', () => {
    const buf = new TextEncoder().encode('이름,나이\n홍길동,30').buffer
    expect(decodeTextBuffer(buf)).toBe('이름,나이\n홍길동,30')
  })
  it('UTF-8 로 해석할 수 없으면 EUC-KR 로 다시 읽는다', () => {
    expect(decodeTextBuffer(HANGUL_EUC_KR.buffer)).toBe('한글')
  })
  it('선행 BOM 은 제거한다', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b')])
    expect(decodeTextBuffer(withBom.buffer)).toBe('a,b')
  })
})

describe('hasPdfMagicBytes', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  it('맨 앞의 %PDF- 를 PDF 로 본다', () => {
    expect(hasPdfMagicBytes(enc('%PDF-1.7\n...'))).toBe(true)
  })
  it('앞부분 잡음 뒤의 %PDF- 도 PDF 로 본다', () => {
    expect(hasPdfMagicBytes(enc('\r\n  junk%PDF-1.4'))).toBe(true)
  })
  it('PDF 로 위장한 HTML 은 PDF 가 아니다', () => {
    expect(hasPdfMagicBytes(enc('<html><script>alert(1)</script></html>'))).toBe(false)
  })
  it('1024 바이트 뒤에 있는 %PDF- 는 인정하지 않는다', () => {
    const late = new Uint8Array(1100)
    late.set(enc('%PDF-'), 1050)
    expect(hasPdfMagicBytes(late)).toBe(false)
  })
})
