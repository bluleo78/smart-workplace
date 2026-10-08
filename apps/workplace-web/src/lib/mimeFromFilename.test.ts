import { describe, expect, it } from 'vitest'

import { canonicalMime, isGenericMime, mimeFromFilename } from './mimeFromFilename'
import { resolvePreviewKind } from './previewKind'

describe('mimeFromFilename', () => {
  it('대소문자와 무관하게 마지막 확장자로 고른다', () => {
    expect(mimeFromFilename('report.PDF')).toBe('application/pdf')
    expect(mimeFromFilename('사진.JpG')).toBe('image/jpeg')
    expect(mimeFromFilename('notes.v2.md')).toBe('text/markdown')
  })

  it('확장자가 없거나 모르는 형식·이름 없음은 null', () => {
    expect(mimeFromFilename('README')).toBeNull()
    expect(mimeFromFilename('a.tar.gz')).toBeNull()
    expect(mimeFromFilename('.hidden.')).toBeNull()
    expect(mimeFromFilename(null)).toBeNull()
    expect(mimeFromFilename('')).toBeNull()
  })

  it('돌려주는 형식은 모두 미리보기 렌더러가 있는 종류다(정확 일치 형식)', () => {
    const cases: [string, string][] = [
      ['a.pdf', 'PDF'], ['a.png', 'IMAGE'], ['a.webp', 'IMAGE'],
      ['a.md', 'MARKDOWN'], ['a.markdown', 'MARKDOWN'], ['a.txt', 'TEXT'], ['a.log', 'TEXT'],
      ['a.csv', 'CSV'], ['a.json', 'TEXT'], ['a.xml', 'TEXT'], ['a.yml', 'TEXT'], ['a.yaml', 'TEXT'],
      ['a.html', 'HTML'], ['a.htm', 'HTML'], ['a.xlsx', 'XLSX'], ['a.docx', 'DOCX'],
    ]
    for (const [name, kind] of cases) expect([name, resolvePreviewKind(mimeFromFilename(name)!)]).toEqual([name, kind])
  })

  it('svg 는 파일명으로 추론하지 않는다(보안 — 범용 형식 바이트를 SVG 로 바꿔 달지 않게)', () => {
    expect(mimeFromFilename('x.svg')).toBeNull()
    expect(mimeFromFilename('LOGO.SVG')).toBeNull()
  })
})

describe('canonicalMime / isGenericMime', () => {
  it('파라미터·대소문자를 떼고 별칭을 표준 이름으로 바꾼다', () => {
    expect(canonicalMime('Application/X-PDF; name=a.pdf')).toBe('application/pdf')
    expect(canonicalMime('image/jpg')).toBe('image/jpeg')
    expect(canonicalMime('image/pjpeg')).toBe('image/jpeg')
    expect(canonicalMime(null)).toBe('')
  })

  it('범용 형식(파라미터 포함)과 빈 형식은 generic, 구체적인 형식은 아니다', () => {
    for (const t of ['application/octet-stream', 'application/octet-stream; name="logo.png"', 'binary/octet-stream',
      'application/force-download', 'application/x-download', 'APPLICATION/UNKNOWN', '', null]) {
      expect([t, isGenericMime(t)]).toEqual([t, true])
    }
    expect(isGenericMime('application/pdf')).toBe(false)
    expect(isGenericMime('image/svg+xml')).toBe(false)
  })
})
