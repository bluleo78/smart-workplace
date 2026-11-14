import { describe, expect, it } from 'vitest'

import {
  clipboardTextIsFileNames,
  droppedFilesWithoutFolders,
  isNonInlineImage,
  parseWikiAttachmentUrl,
  rememberWikiAttachment,
  WIKI_MAX_FILE_BYTES,
  wikiAttachmentMeta,
  wikiUploadKind,
  wikiUploadRejection,
} from './wikiAttachments'

// 노트 본문 파일 첨부(WP-1545) 공용 규칙 — 어느 링크가 첨부 칩이 되는지, 업로드 전에 무엇을 거르는지.

/** 크기만 원하는 값으로 둔 가짜 파일 — 실제 바이트를 만들지 않는다. */
function fakeFile(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('parseWikiAttachmentUrl — 칩이 되는 주소', () => {
  it('앱 첨부 경로는 페이지·파일 id 를 돌려준다', () => {
    expect(parseWikiAttachmentUrl('/api/v1/wiki/pages/12/attachments/34/content')).toEqual({
      pageId: 12,
      fileId: 34,
      url: '/api/v1/wiki/pages/12/attachments/34/content',
      publicToken: null,
    })
  })
  it('공개 공유 경로(서버 마스커가 바꾼 주소)도 첨부다 — 토큰을 함께 돌려준다', () => {
    expect(parseWikiAttachmentUrl('/api/v1/public/wiki/shares/wsh_abc/pages/12/attachments/34')).toEqual({
      pageId: 12,
      fileId: 34,
      url: '/api/v1/public/wiki/shares/wsh_abc/pages/12/attachments/34',
      publicToken: 'wsh_abc',
    })
  })
  it('쿼리·조각은 떼고 본다', () => {
    expect(parseWikiAttachmentUrl('/api/v1/wiki/pages/1/attachments/2/content?x=1#y')?.url).toBe('/api/v1/wiki/pages/1/attachments/2/content')
  })
  it('다른 주소는 첨부가 아니다', () => {
    for (const href of [
      'https://example.com/a.pdf',
      '/api/v1/wiki/pages/1/attachments/2/view',
      '/api/v1/projects/WP/issues/1/attachments/2/content',
      '/wiki/spaces/1/pages/2',
      '',
      null,
    ]) {
      expect(parseWikiAttachmentUrl(href)).toBeNull()
    }
  })
})

describe('업로드 사전 검사', () => {
  it('PNG·JPEG·GIF·WebP 만 이미지, 그 밖(SVG·PDF 등)은 파일로 올린다', () => {
    expect(wikiUploadKind({ type: 'image/png' })).toBe('image')
    expect(wikiUploadKind({ type: 'image/svg+xml' })).toBe('file')
    expect(wikiUploadKind({ type: 'application/pdf' })).toBe('file')
    expect(wikiUploadKind({ type: '' })).toBe('file')
  })
  it('파일은 25MB 까지 — 넘으면 서버와 같은 문구', () => {
    expect(wikiUploadRejection(fakeFile('a.pdf', 'application/pdf', WIKI_MAX_FILE_BYTES))).toBeNull()
    expect(wikiUploadRejection(fakeFile('big.pdf', 'application/pdf', WIKI_MAX_FILE_BYTES + 1))).toBe(
      '첨부 파일은 최대 25MB까지 업로드할 수 있습니다: big.pdf',
    )
  })
  it('이미지는 예전대로 10MB — 11MB PNG 는 거절, 11MB PDF 는 통과', () => {
    const elevenMb = 11 * 1024 * 1024
    expect(wikiUploadRejection(fakeFile('a.png', 'image/png', elevenMb))).toBe('PNG·JPEG·GIF·WebP 이미지만 10MB 까지 올릴 수 있습니다.')
    expect(wikiUploadRejection(fakeFile('a.pdf', 'application/pdf', elevenMb))).toBeNull()
  })
})

describe('clipboardTextIsFileNames — 파일 복사에 딸려 온 이름', () => {
  const files = [{ name: 'report.pdf' }, { name: 'app.log' }]
  it('이름뿐(경로 포함·여러 줄)이면 참', () => {
    expect(clipboardTextIsFileNames('report.pdf', files)).toBe(true)
    expect(clipboardTextIsFileNames('/Users/me/report.pdf\napp.log', files)).toBe(true)
    expect(clipboardTextIsFileNames('', files)).toBe(true)
  })
  it('다른 글자가 섞이면 거짓(기본 붙여넣기를 살린다)', () => {
    expect(clipboardTextIsFileNames('엑셀표 텍스트', files)).toBe(false)
    expect(clipboardTextIsFileNames('report.pdf\n메모', files)).toBe(false)
  })
  it('Finder 로 여러 파일을 복사하면 File 이 이름보다 적게 실려도 이름뿐으로 본다', () => {
    // 이름 셋, File 하나 — 나머지 줄도 파일 이름처럼 보이면 잃을 글자가 없다.
    expect(clipboardTextIsFileNames('report.pdf\n회의 메모.docx\nshot 2026-11-14.png', [{ name: 'report.pdf' }])).toBe(true)
  })
  it('File 이름이 글자에 없거나, 나머지 줄이 문장이면 거짓', () => {
    expect(clipboardTextIsFileNames('summary.txt\nnotes.md', [{ name: 'report.pdf' }])).toBe(false)
    expect(clipboardTextIsFileNames('report.pdf\n이 파일을 확인해 주세요. 결과는 summary.txt', [{ name: 'report.pdf' }])).toBe(false)
    expect(clipboardTextIsFileNames('report.pdf\n확장자 없는 줄', [{ name: 'report.pdf' }])).toBe(false)
    expect(clipboardTextIsFileNames('report.pdf', [])).toBe(false)
  })
})

describe('isNonInlineImage — 그림이 아니라 파일로 첨부되는 이미지', () => {
  it('4종 밖의 image/* 만 참', () => {
    expect(isNonInlineImage({ type: 'image/tiff' })).toBe(true)
    expect(isNonInlineImage({ type: 'image/heic' })).toBe(true)
    expect(isNonInlineImage({ type: 'image/svg+xml' })).toBe(true)
    expect(isNonInlineImage({ type: 'image/png' })).toBe(false)
    expect(isNonInlineImage({ type: 'application/pdf' })).toBe(false)
  })
})

describe('droppedFilesWithoutFolders — 폴더 드롭 거르기', () => {
  const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
  const folder = new File([], 'photos', { type: '' })
  const item = (isDirectory: boolean) => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory }) })
  it('webkitGetAsEntry 로 폴더를 알아보고 뺀다', () => {
    const dt = { files: [pdf, folder], items: [item(false), item(true)] } as unknown as DataTransfer
    expect(droppedFilesWithoutFolders(dt)).toEqual({ files: [pdf], skippedFolder: true })
  })
  it('그 API 가 없으면 크기 0·형식 없음을 폴더로 본다', () => {
    const dt = { files: [folder, pdf], items: [] } as unknown as DataTransfer
    expect(droppedFilesWithoutFolders(dt)).toEqual({ files: [pdf], skippedFolder: true })
  })
  it('폴더가 없으면 그대로', () => {
    const dt = { files: [pdf], items: [item(false)] } as unknown as DataTransfer
    expect(droppedFilesWithoutFolders(dt)).toEqual({ files: [pdf], skippedFolder: false })
  })
})

describe('업로드 응답 기억', () => {
  it('올린 파일의 이름·형식·크기를 주소로 찾는다', () => {
    rememberWikiAttachment({ url: '/api/v1/wiki/pages/7/attachments/8/content', originalName: 'a.zip', mimeType: 'application/zip', sizeBytes: 2048 })
    expect(wikiAttachmentMeta('/api/v1/wiki/pages/7/attachments/8/content')).toEqual({ name: 'a.zip', mimeType: 'application/zip', sizeBytes: 2048 })
    expect(wikiAttachmentMeta('/api/v1/wiki/pages/7/attachments/9/content')).toBeUndefined()
  })
})
