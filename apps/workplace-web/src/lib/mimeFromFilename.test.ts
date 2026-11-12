import { describe, expect, it } from 'vitest'

import { attachmentMime, canonicalMime, isGenericMime, isVideoFile, mimeFromFilename } from './mimeFromFilename'
import { CONVERTIBLE_MIMES, resolvePreviewKind } from './previewKind'

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
      ['a.html', 'HTML'], ['a.htm', 'HTML'], ['a.xlsx', 'XLSX'],
    ]
    for (const [name, kind] of cases) expect([name, resolvePreviewKind(mimeFromFilename(name)!)]).toEqual([name, kind])
  })

  it('워드(docx)는 서버 변환 PDF 대상 형식을 돌려준다 — 대문자 확장자도(WP-1457)', () => {
    expect(CONVERTIBLE_MIMES.has(mimeFromFilename('a.docx')!)).toBe(true)
    expect(CONVERTIBLE_MIMES.has(mimeFromFilename('보고서.DOCX')!)).toBe(true)
  })

  it('영상·오디오 확장자는 VIDEO·AUDIO 로 판정되는 형식을 돌려준다(WP-281)', () => {
    const cases: [string, string, string][] = [
      ['a.mp4', 'video/mp4', 'VIDEO'], ['a.M4V', 'video/mp4', 'VIDEO'], ['a.webm', 'video/webm', 'VIDEO'],
      ['a.mov', 'video/quicktime', 'VIDEO'], ['a.mp3', 'audio/mpeg', 'AUDIO'], ['a.m4a', 'audio/mp4', 'AUDIO'],
      ['a.wav', 'audio/wav', 'AUDIO'], ['a.ogg', 'audio/ogg', 'AUDIO'], ['a.oga', 'audio/ogg', 'AUDIO'],
      ['a.aac', 'audio/aac', 'AUDIO'], ['a.flac', 'audio/flac', 'AUDIO'],
    ]
    for (const [name, mime, kind] of cases) {
      const m = mimeFromFilename(name)
      expect([name, m, resolvePreviewKind(m!)]).toEqual([name, mime, kind])
    }
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
    expect(canonicalMime('audio/x-wav')).toBe('audio/wav')
    expect(canonicalMime('Audio/MP3')).toBe('audio/mpeg')
    expect(canonicalMime('audio/x-m4a')).toBe('audio/mp4')
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

describe('동영상 판정(WP-1519) — 서버 MimeNormalizer 동영상 확장자 표·VIDEO 범주와 같은 규칙', () => {
  it('서버 표의 동영상 확장자를 모두 안다(m4v 는 서버와 같이 video/mp4)', () => {
    expect(mimeFromFilename('a.mkv')).toBe('video/x-matroska')
    expect(mimeFromFilename('a.AVI')).toBe('video/x-msvideo')
    expect(mimeFromFilename('a.m4v')).toBe('video/mp4')
    expect(mimeFromFilename('a.3gp')).toBe('video/3gpp')
    expect(mimeFromFilename('a.m2ts')).toBe('video/mp2t')
  })

  it('구체적 형식은 그대로, 범용 형식이면 이름으로 — 옛 octet-stream 동영상도 동영상', () => {
    expect(isVideoFile('application/octet-stream', '촬영.MOV')).toBe(true)
    expect(isVideoFile(undefined, 'clip.mp4')).toBe(true)
    expect(isVideoFile('Video/X-Flv; x=1', 'a.bin')).toBe(true)
    expect(isVideoFile('application/zip', 'a.mp4')).toBe(false)
    expect(isVideoFile('application/octet-stream', 'a.zip')).toBe(false)
    expect(attachmentMime('', 'a.webm')).toBe('video/webm')
  })
})
