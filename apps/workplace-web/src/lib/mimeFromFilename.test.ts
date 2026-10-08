import { describe, expect, it } from 'vitest'

import { mimeFromFilename } from './mimeFromFilename'
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
      ['a.pdf', 'PDF'], ['a.png', 'IMAGE'], ['a.svg', 'IMAGE'], ['a.webp', 'IMAGE'],
      ['a.md', 'MARKDOWN'], ['a.markdown', 'MARKDOWN'], ['a.txt', 'TEXT'], ['a.log', 'TEXT'],
      ['a.csv', 'CSV'], ['a.json', 'TEXT'], ['a.xml', 'TEXT'], ['a.yml', 'TEXT'], ['a.yaml', 'TEXT'],
      ['a.html', 'HTML'], ['a.htm', 'HTML'], ['a.xlsx', 'XLSX'], ['a.docx', 'DOCX'],
    ]
    for (const [name, kind] of cases) expect([name, resolvePreviewKind(mimeFromFilename(name)!)]).toEqual([name, kind])
  })
})
