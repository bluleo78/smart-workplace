import { describe, expect, it } from 'vitest'

import { resolvePreviewKind } from './previewKind'

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
  it('미지원/공백은 UNSUPPORTED', () => {
    expect(resolvePreviewKind('application/zip')).toBe('UNSUPPORTED')
    expect(resolvePreviewKind('')).toBe('UNSUPPORTED')
  })
})
