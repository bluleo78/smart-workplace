import { describe, expect, it } from 'vitest'

import { decodeTextBuffer, hasPdfMagicBytes, needsPreviewConfirm, PREVIEW_CONFIRM_BYTES } from './previewContent'

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
  it('잘못된 바이트가 하나 섞인 UTF-8 한글 문서는 EUC-KR 로 바꾸지 않는다', () => {
    const enc = new TextEncoder()
    const bytes = new Uint8Array([
      ...enc.encode('안녕하세요 로그입니다.\n'),
      0xff,
      ...enc.encode('다음 줄 한글'),
    ])
    expect(decodeTextBuffer(bytes.buffer)).toBe('안녕하세요 로그입니다.\n\uFFFD다음 줄 한글')
  })
  it('한글이 머리글에만 있는 긴 EUC-KR CSV 도 EUC-KR 로 읽는다', () => {
    const header = [0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xb3, 0xaa, 0xc0, 0xcc, 0x0a] // '이름,나이\n'
    const rows = new TextEncoder().encode('1,2\n'.repeat(5000))
    const bytes = new Uint8Array([...header, ...rows])
    expect(decodeTextBuffer(bytes.buffer).startsWith('이름,나이\n1,2')).toBe(true)
  })
  it('앞부분만 자른 버퍼는 끝의 반쪽 글자를 버리고 UTF-8 로 읽는다', () => {
    const full = new TextEncoder().encode('가나')
    const cut = full.slice(0, 4) // '가'(3바이트) + '나'의 첫 바이트
    expect(decodeTextBuffer(cut.buffer, { truncated: true })).toBe('가')
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

describe('needsPreviewConfirm', () => {
  it('10MB 이하는 묻지 않고 바로 미리본다', () => {
    expect(needsPreviewConfirm(PREVIEW_CONFIRM_BYTES, false)).toBe(false)
    expect(needsPreviewConfirm(2 * 1024 * 1024, false)).toBe(false)
  })
  it('10MB 를 넘으면 동의 전까지 묻는다', () => {
    expect(needsPreviewConfirm(PREVIEW_CONFIRM_BYTES + 1, false)).toBe(true)
    expect(needsPreviewConfirm(PREVIEW_CONFIRM_BYTES + 1, true)).toBe(false)
  })
  it('크기를 모르면 묻지 않는다(받은 뒤 실제 크기로 다시 판단)', () => {
    expect(needsPreviewConfirm(null, false)).toBe(false)
  })
})
