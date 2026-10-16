import { describe, expect, it } from 'vitest'

import { CONVERTIBLE_MIMES, isPresentationMime, resolvePreviewKind, XLS_MIME } from './previewKind'

describe('resolvePreviewKind', () => {
  it('이미지 mime(svg 포함)는 IMAGE', () => {
    expect(resolvePreviewKind('image/png')).toBe('IMAGE')
    expect(resolvePreviewKind('image/svg+xml')).toBe('IMAGE')
  })
  it('pdf는 PDF', () => {
    expect(resolvePreviewKind('application/pdf')).toBe('PDF')
  })
  it('markdown은 MARKDOWN, 나머지 text는 TEXT', () => {
    expect(resolvePreviewKind('text/markdown')).toBe('MARKDOWN')
    expect(resolvePreviewKind('text/plain')).toBe('TEXT')
    expect(resolvePreviewKind('application/json')).toBe('TEXT')
    expect(resolvePreviewKind('text/xml')).toBe('TEXT')
    expect(resolvePreviewKind('application/x-yaml')).toBe('TEXT')
  })
  it('csv는 CSV', () => {
    expect(resolvePreviewKind('text/csv')).toBe('CSV')
    expect(resolvePreviewKind('application/csv')).toBe('CSV')
  })
  it('office 문서는 XLSX/DOCX', () => {
    expect(
      resolvePreviewKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('XLSX')
    expect(
      resolvePreviewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('DOCX')
  })
  it('영상·오디오 계열은 VIDEO·AUDIO(WP-281) — 코덱과 무관하게 계열로 받는다', () => {
    for (const t of ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']) {
      expect([t, resolvePreviewKind(t)]).toEqual([t, 'VIDEO'])
    }
    for (const t of ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac']) {
      expect([t, resolvePreviewKind(t)]).toEqual([t, 'AUDIO'])
    }
  })
  it('미지원/공백은 UNSUPPORTED', () => {
    expect(resolvePreviewKind('application/zip')).toBe('UNSUPPORTED')
    expect(resolvePreviewKind('')).toBe('UNSUPPORTED')
  })
  it('구형 엑셀(XLS)은 XLSX 시트 미리보기로 연다(WP-431)', () => {
    expect(XLS_MIME).toBe('application/vnd.ms-excel')
    expect(resolvePreviewKind('application/vnd.ms-excel')).toBe('XLSX')
  })
  it('변환 대상 5종은 mime 만으로는 UNSUPPORTED — 변환 미리보기는 드라이브 항목(previewPath)만 판정한다(WP-431)', () => {
    const convertible = [
      'application/x-hwp',
      'application/hwp+zip',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/msword',
    ]
    expect([...CONVERTIBLE_MIMES].sort()).toEqual([...convertible].sort())
    for (const t of convertible) expect([t, resolvePreviewKind(t)]).toEqual([t, 'UNSUPPORTED'])
  })
  it('isPresentationMime 은 pptx·ppt 만 참', () => {
    expect(isPresentationMime('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe(true)
    expect(isPresentationMime('application/vnd.ms-powerpoint')).toBe(true)
    expect(isPresentationMime('application/x-hwp')).toBe(false)
    expect(isPresentationMime('application/msword')).toBe(false)
  })
})
