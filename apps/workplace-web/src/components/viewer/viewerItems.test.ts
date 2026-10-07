import { describe, expect, it } from 'vitest'

import type { IssueAttachment } from '../../types/attachment'
import type { DriveFile, DriveLink, VirtualAttachment } from '../../types/drive'
import {
  driveFileItem,
  driveViewerKey,
  fileViewerKey,
  issueAttachmentItem,
  issueBodyImageItem,
  issueDriveLinkItem,
  normalizeAttachmentPreviewKey,
  parseViewerKey,
  resolveBundle,
  virtualAttachmentItem,
} from './viewerItems'

const file = { id: 70, fileId: 200, name: '기획안.pdf', mimeType: 'application/pdf', sizeBytes: 300 } as DriveFile

describe('driveFileItem', () => {
  it('드라이브 파일은 요약·참조된 곳을 쓰고 가져오기는 없다', () => {
    const it = driveFileItem(file)
    expect(it).toMatchObject({
      key: 'drive:70',
      contentPath: '/drive/files/70/content',
      downloadPath: '/drive/files/70/download',
      summaryDriveFileId: 70,
      backlinksDriveFileId: 70,
    })
    expect(it.importFileId).toBeUndefined()
  })
})

describe('virtualAttachmentItem', () => {
  it('가상 첨부는 downloadUrl 로 받고 드라이브로 가져오기·원본 이동만 있다', () => {
    const a = { fileId: 9, name: 'a.png', mimeType: 'image/png', sizeBytes: 10, downloadUrl: '/api/v1/x/9/content', deepLink: '/projects/WP/issues/3' } as VirtualAttachment
    expect(virtualAttachmentItem(a)).toEqual({
      key: 'file:9', name: 'a.png', mimeType: 'image/png', sizeBytes: 10,
      contentPath: '/api/v1/x/9/content', downloadPath: '/api/v1/x/9/content',
      importFileId: 9, sourceLink: '/projects/WP/issues/3',
    })
  })
})

describe('issueAttachmentItem / issueDriveLinkItem', () => {
  it('이슈 업로드 첨부는 가져오기 가능, 요약 없음', () => {
    const a = { fileId: 5, originalName: '로그.txt', mimeType: 'text/plain', sizeBytes: 3 } as IssueAttachment
    expect(issueAttachmentItem('WP', 12, a)).toMatchObject({
      key: 'file:5', name: '로그.txt', contentPath: '/projects/WP/issues/12/attachments/5/content', importFileId: 5,
    })
    expect(issueAttachmentItem('WP', 12, a).summaryDriveFileId).toBeUndefined()
  })
  it('이슈 드라이브 링크가 휴지통·삭제면 unavailable 이고 요약·드라이브에서 열기가 없다', () => {
    const l = { driveFileId: 70, fileId: 200, name: '기획안.pdf', mimeType: 'application/pdf', sizeBytes: 300, spaceId: 1, availability: 'TRASHED' } as DriveLink
    const it = issueDriveLinkItem('WP', 12, l)
    expect(it).toMatchObject({
      key: 'drive:70', contentPath: '/projects/WP/issues/12/drive-links/70/content', unavailable: true,
    })
    // 휴지통·삭제된 원본은 요약·드라이브에서 열기를 걸지 않는다(열어도 볼 수 없는 곳으로 보내지 않게).
    expect(it.summaryDriveFileId).toBeUndefined()
    expect(it.driveOpen).toBeUndefined()
  })
  it('활성 드라이브 링크는 요약·드라이브에서 열기를 쓴다', () => {
    const l = { driveFileId: 71, fileId: 201, name: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 3, spaceId: 2, availability: 'ACTIVE' } as DriveLink
    expect(issueDriveLinkItem('WP', 12, l)).toMatchObject({
      key: 'drive:71', summaryDriveFileId: 71, driveOpen: { spaceId: 2, driveFileId: 71, name: 'b.pdf' }, unavailable: false,
    })
  })
})

describe('issueBodyImageItem', () => {
  it('blob 이 없으면 크기 null·image/png 로 둔다', () => {
    expect(issueBodyImageItem({ src: '/api/v1/p/i.png', fileId: 3, alt: '', blob: null })).toMatchObject({
      key: 'file:3', name: 'image', mimeType: 'image/png', sizeBytes: null,
    })
  })
})

describe('resolveBundle', () => {
  const a = { key: 'a' } as never, b = { key: 'b' } as never, c = { key: 'c' } as never
  it('목록에 있으면 그 위치', () => {
    expect(resolveBundle([a, b, c], 'b', null)).toEqual({ items: [a, b, c], index: 1 })
  })
  it('목록에서 빠졌으면 스냅숏 1건 묶음', () => {
    const snap = { key: 'z' } as never
    expect(resolveBundle([a, b], 'z', snap)).toEqual({ items: [snap], index: 0 })
  })
  it('닫힘·스냅숏 불일치면 null', () => {
    expect(resolveBundle([a], null, null)).toBeNull()
    expect(resolveBundle([a], 'z', { key: 'y' } as never)).toBeNull()
  })
})

describe('normalizeAttachmentPreviewKey', () => {
  it('예전 숫자 ?preview=123 은 file:123 으로 읽는다(옛 딥링크 호환)', () => {
    expect(normalizeAttachmentPreviewKey('123')).toBe('file:123')
  })
  it('이미 키 형식이거나 비어 있으면 그대로', () => {
    expect(normalizeAttachmentPreviewKey('file:9')).toBe('file:9')
    expect(normalizeAttachmentPreviewKey(null)).toBeNull()
  })
})

describe('parseViewerKey', () => {
  it('키를 만든 함수와 왕복한다(file·drive)', () => {
    expect(parseViewerKey(driveViewerKey(70))).toEqual({ kind: 'drive', id: 70 })
    expect(parseViewerKey(fileViewerKey(200))).toEqual({ kind: 'file', id: 200 })
  })

  it('형식이 아닌 값(null·숫자만·다른 접두어·숫자 아님·여분 문자)은 null', () => {
    for (const v of [null, '', '70', 'mail:1', 'drive:', 'drive:abc', 'drive:1x', ' file:1', 'file:-1']) {
      expect(parseViewerKey(v)).toBeNull()
    }
  })
})
