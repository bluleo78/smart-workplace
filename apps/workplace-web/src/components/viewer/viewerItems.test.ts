import { describe, expect, it } from 'vitest'

import type { IssueAttachment } from '../../types/attachment'
import type { DriveFile, DriveLink, VirtualAttachment } from '../../types/drive'
import type { HomeUploadedFile } from '../../types/home'
import type { EmailAttachmentMeta } from '../../types/mailMessage'
import type { MessageAttachment } from '../../types/messaging'
import {
  attachmentMime,
  driveFileItem,
  driveViewerKey,
  fileViewerKey,
  findChatBundle,
  findHomeChatBundle,
  homeChatAttachmentItem,
  isMailViewerKey,
  issueAttachmentItem,
  issueBodyImageItem,
  issueChatAttachmentItem,
  issueChatBundle,
  issueChatDriveLinkItem,
  issueDriveLinkItem,
  mailAttachmentItem,
  mailViewerKey,
  normalizeAttachmentPreviewKey,
  parseChatViewerKey,
  parseViewerKey,
  resolveBundle,
  teamChatAttachmentItem,
  teamChatBundle,
  teamChatDriveLinkItem,
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

describe('mailAttachmentItem', () => {
  const att = (o: Partial<EmailAttachmentMeta> = {}): EmailAttachmentMeta => ({
    id: 7, filename: '안건.pdf', contentType: 'application/pdf', sizeBytes: 1234, contentId: null, ...o,
  })

  it('메일 첨부는 mail: 키·첨부 콘텐츠 경로로 받고 ✨·☁·참조·원본 이동은 없다', () => {
    expect(mailAttachmentItem(att())).toEqual({
      key: 'mail:7', name: '안건.pdf', mimeType: 'application/pdf', sizeBytes: 1234,
      contentPath: '/mail/attachments/7/content', downloadPath: '/mail/attachments/7/content',
    })
  })

  it('형식은 파라미터를 떼고 소문자로 맞춘다(Graph 경로는 원문 그대로 저장)', () => {
    expect(mailAttachmentItem(att({ contentType: ' Image/PNG; name="a.png"' })).mimeType).toBe('image/png')
  })

  it('octet-stream·빈 형식이면 파일명 확장자로 추론한다 — 서버의 구체적인 형식은 그대로 믿는다', () => {
    expect(mailAttachmentItem(att({ filename: 'report.PDF', contentType: 'application/octet-stream' })).mimeType).toBe('application/pdf')
    expect(mailAttachmentItem(att({ filename: 'notes.md', contentType: null })).mimeType).toBe('text/markdown')
    expect(mailAttachmentItem(att({ filename: 'page.htm', contentType: 'Application/Octet-Stream; name=page.htm' })).mimeType).toBe('text/html')
    expect(mailAttachmentItem(att({ filename: 'a.tar.gz', contentType: 'application/octet-stream' })).mimeType).toBe('application/octet-stream')
    expect(mailAttachmentItem(att({ filename: 'a.pdf', contentType: 'image/png' })).mimeType).toBe('image/png')
    expect(mailAttachmentItem(att({ filename: 'a.pdf', contentType: 'application/force-download' })).mimeType).toBe('application/pdf')
    expect(mailAttachmentItem(att({ filename: 'b.jpg', contentType: 'binary/octet-stream' })).mimeType).toBe('image/jpeg')
    // svg 는 파일명으로 추론하지 않는다(보안).
    expect(mailAttachmentItem(att({ filename: 'x.svg', contentType: 'application/octet-stream' })).mimeType).toBe('application/octet-stream')
  })

  it('형식 별칭은 표준 이름으로 맞춘다', () => {
    expect(mailAttachmentItem(att({ contentType: 'application/x-pdf' })).mimeType).toBe('application/pdf')
    expect(mailAttachmentItem(att({ filename: 'p.jpg', contentType: 'image/pjpeg' })).mimeType).toBe('image/jpeg')
  })

  it('형식·파일명이 없으면 octet-stream·attachment-{id} 로 채운다(예전 다운로드 파일명 규칙)', () => {
    const it = mailAttachmentItem(att({ filename: null, contentType: null }))
    expect(it.mimeType).toBe('application/octet-stream')
    expect(it.name).toBe('attachment-7')
    expect(mailAttachmentItem(att({ filename: '', contentType: '  ' }))).toMatchObject({
      name: 'attachment-7', mimeType: 'application/octet-stream',
    })
  })
})

describe('mailViewerKey / isMailViewerKey', () => {
  it('mail:{숫자} 만 메일 키로 본다 — 다른 화면 키·잘못된 값은 아니다', () => {
    expect(mailViewerKey(3)).toBe('mail:3')
    expect(isMailViewerKey('mail:3')).toBe(true)
    expect(isMailViewerKey('file:3')).toBe(false)
    expect(isMailViewerKey('mail:x')).toBe(false)
    expect(isMailViewerKey(null)).toBe(false)
  })

  it('메일 키는 드라이브·이슈 호스트의 parseViewerKey 에 잡히지 않는다', () => {
    expect(parseViewerKey('mail:3')).toBeNull()
  })
})

// ─── 채팅 3곳(WP-279) ─────────────────────────────────────────────────────────

const msgAtt = (o: Partial<MessageAttachment> = {}): MessageAttachment =>
  ({ fileId: 5, messageId: 42, originalName: '사진.png', mimeType: 'image/png', sizeBytes: 10, ...o }) as MessageAttachment
const link = (o: Partial<DriveLink> = {}): DriveLink =>
  ({ driveFileId: 70, fileId: 200, name: '기획안.pdf', mimeType: 'application/pdf', sizeBytes: 300, spaceId: 1, availability: 'ACTIVE', ...o }) as DriveLink

describe('attachmentMime', () => {
  it('구체적인 형식은 정규화만, 범용·빈 형식이면 파일명으로 추론한다(SVG 는 추론하지 않음)', () => {
    expect(attachmentMime('Image/PNG; x=1', 'a.pdf')).toBe('image/png')
    expect(attachmentMime('application/octet-stream', 'r.PDF')).toBe('application/pdf')
    expect(attachmentMime('', 'n.md')).toBe('text/markdown')
    expect(attachmentMime(null, null)).toBe('application/octet-stream')
    expect(attachmentMime('application/octet-stream', 'x.svg')).toBe('application/octet-stream')
  })
})

describe('teamChatAttachmentItem / teamChatDriveLinkItem', () => {
  it('팀 채팅 업로드는 메시지 첨부 경로·msg 키, ☁ 가져오기만 있다', () => {
    expect(teamChatAttachmentItem(3, msgAtt())).toEqual({
      key: 'msg:42:file:5', name: '사진.png', mimeType: 'image/png', sizeBytes: 10,
      contentPath: '/messaging/channels/3/messages/42/attachments/5/content',
      downloadPath: '/messaging/channels/3/messages/42/attachments/5/content',
      importFileId: 5,
    })
  })
  it('팀 채팅은 업로드 형식을 원문 저장한다 — 범용 형식이면 파일명으로 추론', () => {
    expect(teamChatAttachmentItem(3, msgAtt({ originalName: '보고서.pdf', mimeType: 'application/octet-stream' })).mimeType).toBe('application/pdf')
    expect(teamChatAttachmentItem(3, msgAtt({ originalName: 'logo.svg', mimeType: 'application/octet-stream' })).mimeType).toBe('application/octet-stream')
  })
  it('활성 드라이브 링크는 ✨·드라이브에서 열기, ☁ 없음', () => {
    const it = teamChatDriveLinkItem(3, 42, link())
    expect(it).toMatchObject({
      key: 'msg:42:drive:70',
      contentPath: '/messaging/channels/3/messages/42/drive-links/70/content',
      downloadPath: '/messaging/channels/3/messages/42/drive-links/70/content',
      summaryDriveFileId: 70,
      driveOpen: { spaceId: 1, driveFileId: 70, name: '기획안.pdf' },
      unavailable: false,
    })
    expect(it.importFileId).toBeUndefined()
    expect(it.sourceLink).toBeUndefined()
  })
  it('원본이 휴지통·삭제된 링크는 unavailable, ✨·드라이브에서 열기 없음', () => {
    const it = teamChatDriveLinkItem(3, 42, link({ availability: 'DELETED' }))
    expect(it.unavailable).toBe(true)
    expect(it.summaryDriveFileId).toBeUndefined()
    expect(it.driveOpen).toBeUndefined()
  })
})

describe('issueChatAttachmentItem / issueChatDriveLinkItem', () => {
  it('이슈 채팅 업로드는 스레드 메시지 첨부 경로·cmsg 키, ☁ 만', () => {
    expect(issueChatAttachmentItem(8, msgAtt({ mimeType: 'text/plain', originalName: 'a.txt' }))).toEqual({
      key: 'cmsg:42:file:5', name: 'a.txt', mimeType: 'text/plain', sizeBytes: 10,
      contentPath: '/chat/threads/8/messages/42/attachments/5/content',
      downloadPath: '/chat/threads/8/messages/42/attachments/5/content',
      importFileId: 5,
    })
  })
  it('이슈 채팅 드라이브 링크는 링크 경로 + ✨', () => {
    expect(issueChatDriveLinkItem(8, 42, link())).toMatchObject({
      key: 'cmsg:42:drive:70',
      contentPath: '/chat/threads/8/messages/42/drive-links/70/content',
      summaryDriveFileId: 70,
      unavailable: false,
    })
    expect(issueChatDriveLinkItem(8, 42, link({ availability: 'TRASHED' })).unavailable).toBe(true)
  })
})

describe('homeChatAttachmentItem', () => {
  it('메인 AI 채팅은 세션 첨부 경로·home:{fileId} 키, ✨·☁·원본 이동이 없다', () => {
    const a: HomeUploadedFile = { fileId: 77, originalName: 'shot.png', mimeType: 'image/png', sizeBytes: 9 }
    expect(homeChatAttachmentItem('s-1', a)).toEqual({
      key: 'home:77', name: 'shot.png', mimeType: 'image/png', sizeBytes: 9,
      contentPath: '/home/sessions/s-1/attachments/77/content',
      downloadPath: '/home/sessions/s-1/attachments/77/content',
    })
  })
})

describe('채팅 키는 다른 호스트 파서에 잡히지 않는다', () => {
  it('드라이브·이슈(parseViewerKey)·메일·첨부 모아보기 정규화가 채팅 키를 자기 키로 보지 않는다', () => {
    const keys = [
      teamChatAttachmentItem(3, msgAtt()).key,
      teamChatDriveLinkItem(3, 42, link()).key,
      issueChatAttachmentItem(8, msgAtt()).key,
      issueChatDriveLinkItem(8, 42, link()).key,
      homeChatAttachmentItem('s', { fileId: 1, originalName: 'a', mimeType: 'image/png', sizeBytes: 1 }).key,
    ]
    for (const k of keys) {
      expect(parseViewerKey(k)).toBeNull()
      expect(isMailViewerKey(k)).toBe(false)
      expect(normalizeAttachmentPreviewKey(k)).toBe(k)
    }
    // 팀 채팅과 이슈 채팅은 같은 메시지 id·파일 id 라도 키가 다르다.
    expect(keys[0]).not.toBe(keys[2])
  })
})

describe('드라이브 링크 형식', () => {
  it('링크 형식도 정규화·파일명 추론을 거친다(대소문자·파라미터·octet-stream)', () => {
    expect(teamChatDriveLinkItem(3, 42, link({ mimeType: 'Application/PDF; x=1' })).mimeType).toBe('application/pdf')
    expect(issueChatDriveLinkItem(8, 42, link({ name: '표.csv', mimeType: 'application/octet-stream' })).mimeType).toBe('text/csv')
  })
})

describe('parseChatViewerKey / findChatBundle / findHomeChatBundle', () => {
  it('키를 표면·메시지 id(또는 fileId)로 읽는다 — 다른 형식은 null', () => {
    expect(parseChatViewerKey('msg:42:file:5')).toEqual({ surface: 'msg', messageId: 42 })
    expect(parseChatViewerKey('cmsg:7:drive:70')).toEqual({ surface: 'cmsg', messageId: 7 })
    expect(parseChatViewerKey('home:77')).toEqual({ surface: 'home', fileId: 77 })
    for (const k of [null, 'file:5', 'msg:x:file:5', 'msg:1:mail:2', 'home:', 'turn:1:file:2']) expect(parseChatViewerKey(k)).toBeNull()
  })

  const m42 = { id: 42, attachments: [msgAtt()], driveLinks: [link()] }
  it('키의 메시지를 목록에서 찾아 그 메시지 묶음을 다시 만든다(업로드 → 링크 순)', () => {
    const b = findChatBundle('msg:42:drive:70', 'msg', [{ id: 1 }, m42], (m) => teamChatBundle(3, m))
    expect(b?.map((i) => i.key)).toEqual(['msg:42:file:5', 'msg:42:drive:70'])
  })
  it('다른 표면 키·목록에 없는 메시지·삭제·미확정·묶음에 없는 항목이면 null', () => {
    const build = (m: typeof m42) => teamChatBundle(3, m)
    expect(findChatBundle('cmsg:42:file:5', 'msg', [m42], build)).toBeNull()
    expect(findChatBundle('msg:43:file:5', 'msg', [m42], build)).toBeNull()
    expect(findChatBundle('msg:42:file:5', 'msg', [{ ...m42, deleted: true }], build)).toBeNull()
    expect(findChatBundle('msg:42:file:9', 'msg', [m42], build)).toBeNull()
    expect(findChatBundle(null, 'msg', [m42], build)).toBeNull()
    expect(findChatBundle('cmsg:42:file:5', 'cmsg', [m42], (m) => issueChatBundle(8, m))?.length).toBe(2)
  })
  it('메인 AI 는 그 fileId 가 든 턴이 묶음, 세션이 없으면 null', () => {
    const a = (fileId: number) => ({ fileId, originalName: `f${fileId}`, mimeType: 'image/png', sizeBytes: 1 })
    const turns = [{ attachments: [a(1), a(2)] }, {}, { attachments: [a(3)] }]
    expect(findHomeChatBundle('home:2', 's', turns)?.map((i) => i.key)).toEqual(['home:1', 'home:2'])
    expect(findHomeChatBundle('home:3', 's', turns)?.length).toBe(1)
    expect(findHomeChatBundle('home:9', 's', turns)).toBeNull()
    expect(findHomeChatBundle('home:1', null, turns)).toBeNull()
  })
})
