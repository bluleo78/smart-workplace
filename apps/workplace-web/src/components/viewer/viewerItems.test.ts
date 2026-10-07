import { describe, expect, it } from 'vitest'

import type { IssueAttachment } from '../../types/attachment'
import type { DriveFile, DriveLink, VirtualAttachment } from '../../types/drive'
import {
  driveFileItem,
  issueAttachmentItem,
  issueBodyImageItem,
  issueDriveLinkItem,
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
  it('이슈 드라이브 링크는 요약·드라이브에서 열기, 휴지통·삭제면 unavailable', () => {
    const l = { driveFileId: 70, fileId: 200, name: '기획안.pdf', mimeType: 'application/pdf', sizeBytes: 300, spaceId: 1, availability: 'TRASHED' } as DriveLink
    expect(issueDriveLinkItem('WP', 12, l)).toMatchObject({
      key: 'drive:70', contentPath: '/projects/WP/issues/12/drive-links/70/content',
      summaryDriveFileId: 70, driveOpenPath: '/drive/spaces/1?preview=70', unavailable: true,
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
