// 채팅 3곳 첨부 뷰어 E2E 모킹(WP-279) — 데스크톱·모바일 spec 이 같은 메시지·첨부 구성을 쓴다.
// 팀 채팅·이슈 채팅은 한 메시지에 [이미지 801 · PDF 802(형식 octet-stream — 파일명 추론) · 활성 드라이브 링크 70(텍스트) · 삭제된 링크 71] 을 둔다
// → 묶음 "n / 4". 다른(본인) 메시지에는 memo 803 하나만 둔다 → 묶음이 메시지 밖으로 넘어가지 않는지(1 / 1) 확인용.
// 메인 AI 채팅은 한 사용자 턴에 [이미지 77 · PDF 78], 다음 사용자 턴에 [memo 79].
import type { Page } from '@playwright/test'

import type { DriveLink } from '../../src/types/drive'
import type { HomeMessage, HomeSessionPage } from '../../src/types/home'
import type { MessageAttachment } from '../../src/types/messaging'
import { createChatMember, createChatMessage, createChatThread } from '../factories/chat.factory'
import { personalSpace } from '../factories/drive.factory'
import { createHomeAttachment } from '../factories/homeAttachment.factory'
import { createChannelMember, createMessage } from '../factories/messaging.factory'
import { mockApi } from './api-mock'
import { json, KEY, stubIssue } from './mobile-chat'
import { stubChat } from './mobile.fixture'
import { solidPng } from './png'
import { SAMPLE_PDF } from './samples'
import { type RequestTracker, trackRequests } from './requests'

const PDF = SAMPLE_PDF
const PNG = solidPng(40, 30)
/** 드라이브 링크(텍스트) 본문 — 뷰어 본문에 그대로 보이는지 확인용. */
export const LINK_TEXT = '링크로 공유한 회의록입니다'
/** 본인 메시지 memo 첨부 본문. */
export const MEMO_TEXT = '다른 메시지의 메모'

/** 메시지 첨부 메타 — 팀·이슈 채팅 MessageAttachment 공용. */
function att(fileId: number, messageId: number, originalName: string, mimeType: string, sizeBytes: number): MessageAttachment {
  return {
    fileId, messageId, originalName, mimeType, sizeBytes,
    attachedById: 20, attachedByName: '동료', attachedAt: '2026-10-08T00:00:00Z',
  }
}

/** 드라이브 링크 메타. */
function link(driveFileId: number, name: string, availability: DriveLink['availability']): DriveLink {
  return {
    driveFileId, fileId: 900 + driveFileId, name, mimeType: 'text/plain', sizeBytes: 64, hasThumbnail: false,
    spaceId: 1, spaceName: '팀 공간', availability, createdById: 20, createdAt: '2026-10-08T00:00:00Z',
  }
}

/** 한 메시지의 첨부 묶음(업로드 3 + 링크 2 중 업로드 2·링크 2). PDF 는 브라우저가 형식을 모를 때처럼 octet-stream 으로 저장돼 있다. */
function bundle(messageId: number) {
  return {
    attachments: [
      att(801, messageId, 'shot.png', 'image/png', PNG.length),
      att(802, messageId, '보고서.pdf', 'application/octet-stream', PDF.length),
    ],
    driveLinks: [link(70, '회의록.txt', 'ACTIVE'), link(71, '지난자료.pdf', 'DELETED')],
  }
}

/** fileId → 업로드 콘텐츠 응답. 서버처럼 저장 형식 그대로 응답 헤더에 준다(802 = octet-stream). */
const UPLOAD_CONTENT: Record<number, { type: string; body: Buffer }> = {
  801: { type: 'image/png', body: PNG },
  802: { type: 'application/octet-stream', body: PDF },
  803: { type: 'text/plain; charset=utf-8', body: Buffer.from(MEMO_TEXT, 'utf-8') },
  // 브라우저가 형식을 모를 때처럼 octet-stream 으로 저장된 PNG — 파일명으로 추론해 썸네일로 그려야 한다.
  804: { type: 'application/octet-stream', body: PNG },
}

/**
 * 업로드·드라이브 링크 콘텐츠 경로를 모킹한다(base = 메시지 경로 앞부분, 예: `/api/v1/messaging/channels/1/messages`).
 * 반환한 tracker 로 "열기 전엔 받지 않는다"·"⬇ 가 다시 받지 않는다"를 확인한다.
 */
async function stubContents(page: Page, base: string): Promise<RequestTracker> {
  const uploadRe = new RegExp(`^${base}/\\d+/attachments/(\\d+)/content$`)
  const linkRe = new RegExp(`^${base}/\\d+/drive-links/(\\d+)/content$`)
  const tracker = trackRequests(page, 'GET', (u) => uploadRe.test(u.pathname) || linkRe.test(u.pathname))
  await page.route((u) => uploadRe.test(u.pathname), (r) => {
    const c = UPLOAD_CONTENT[Number(uploadRe.exec(new URL(r.request().url()).pathname)?.[1])]
    return c ? r.fulfill({ status: 200, contentType: c.type, body: c.body }) : r.fulfill({ status: 404, body: '' })
  })
  await page.route((u) => linkRe.test(u.pathname), (r) =>
    r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: Buffer.from(LINK_TEXT, 'utf-8') }))
  return tracker
}

/** 드라이브 링크 70 의 요약(✨) — ok = 요약 있음, forbidden = 링크 열람자에게 드라이브 권한 없음(403). 개인 공간도 둔다(☁ 활성). */
async function stubDriveSide(page: Page, summary: 'ok' | 'forbidden') {
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/summary', (r) =>
    summary === 'ok'
      ? r.fulfill({ json: { summary: '링크 파일 요약', status: 'DONE' } })
      : r.fulfill({ status: 403, json: { message: 'forbidden' } }))
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/backlinks', (r) => r.fulfill({ json: [] }))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [personalSpace()] }) : r.fallback())
}

export interface ChatViewerStubOptions {
  summary?: 'ok' | 'forbidden'
}

/**
 * 팀 채팅 채널 1 — 메시지 10(동료, 묶음 4개, 답글 1개)·11(본인, memo 803)·12(동료, octet-stream 으로 저장된 photo.png 804).
 * 스레드(?thread=10)도 열 수 있게 답글을 모킹한다 — 스레드 패널에도 부모 메시지 10 이 다시 그려진다(같은 묶음이 두 목록에).
 */
export async function stubTeamChatAttachments(page: Page, opts: ChatViewerStubOptions = {}) {
  await stubChat(page)
  const peer = createMessage({
    id: 10, channelId: 1, authorId: 20, authorName: '동료', body: '자료 공유합니다', replyCount: 1,
    createdAt: '2026-10-08T03:00:00Z', ...bundle(10),
  })
  const own = createMessage({
    id: 11, channelId: 1, authorId: 1, authorName: 'me', body: '메모 첨부',
    createdAt: '2026-10-08T03:10:00Z', attachments: [att(803, 11, 'memo.txt', 'text/plain', 40)],
  })
  const octet = createMessage({
    id: 12, channelId: 1, authorId: 20, authorName: '동료', body: '형식 없는 사진',
    createdAt: '2026-10-08T03:20:00Z', attachments: [att(804, 12, 'photo.png', 'application/octet-stream', PNG.length)],
  })
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ items: [octet, own, peer], nextCursor: null, hasMore: false })) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/members', (r) =>
    r.fulfill(json([createChannelMember({ userId: 1, name: 'me' }), createChannelMember({ userId: 20, name: '동료' })])))
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/read', (r) => r.fulfill({ status: 204, body: '' }))
  await page.route((u) => u.pathname === '/api/v1/messaging/messages/10/replies', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill(json({ items: [createMessage({ id: 30, channelId: 1, parentMessageId: 10, authorId: 1, authorName: 'me', body: '확인했어요' })], nextCursor: null, hasMore: false }))
      : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/messages/10/thread/read', (r) => r.fulfill({ status: 204, body: '' }))
  await stubDriveSide(page, opts.summary ?? 'ok')
  return stubContents(page, '/api/v1/messaging/channels/1/messages')
}

/** 이슈 MOB-1 채팅(스레드 100) — 메시지 501(동료, 묶음 4개)·502(본인, memo 803). */
export async function stubIssueChatAttachments(page: Page, opts: ChatViewerStubOptions = {}) {
  await stubIssue(page)
  const peer = createChatMessage({ id: 501, threadId: 100, authorId: 20, authorName: '동료', body: '자료 공유합니다', ...bundle(501) })
  const own = createChatMessage({
    id: 502, threadId: 100, authorId: 1, authorName: 'me', body: '메모 첨부',
    attachments: [att(803, 502, 'memo.txt', 'text/plain', 40)],
  })
  // stubIssue 의 기본 스레드·메시지보다 나중에 등록해 우선한다(Playwright 는 나중 라우트부터).
  // 첫 화면은 스레드 응답의 recentMessages 로 그리므로 둘 다 바꾼다.
  await page.route(`**/api/v1/projects/${KEY}/issues/1/chat/thread`, (r) =>
    r.fulfill(json(createChatThread({
      threadId: 100,
      members: [createChatMember({ userId: 1, lastReadMessageId: 502 }), createChatMember({ userId: 20, name: '동료' })],
      recentMessages: [peer, own],
    }))))
  await page.route('**/api/v1/chat/threads/100/messages', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ items: [own, peer], nextCursor: null, hasMore: false })) : r.fallback())
  await stubDriveSide(page, opts.summary ?? 'ok')
  return stubContents(page, '/api/v1/chat/threads/100/messages')
}

/** 메인 AI 채팅 세션 s-v — 사용자 턴 [이미지 77·PDF 78], 답변, 사용자 턴 [memo 79]. 대화 전환용 s-w(첨부 없음)도 둔다. */
export async function stubHomeChatAttachments(page: Page) {
  await mockApi(page, 'GET', '/api/v1/home/sessions', {
    items: [
      { id: 's-v', title: '첨부 대화', lastMessageAt: '2026-10-08T00:00:00Z', widgetCount: 0 },
      { id: 's-w', title: '다른 대화', lastMessageAt: '2026-10-07T00:00:00Z', widgetCount: 0 },
    ],
    nextCursor: null,
  } satisfies HomeSessionPage)
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-v/messages', [
    {
      id: 1, role: 'USER', content: '자료 모음', widgets: null, toolCalls: null, createdAt: '2026-10-08T00:00:00Z',
      attachments: [
        createHomeAttachment({ fileId: 77, originalName: 'board.png', mimeType: 'image/png', sizeBytes: PNG.length }),
        createHomeAttachment({ fileId: 78, originalName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length }),
      ],
    },
    { id: 2, role: 'ASSISTANT', content: '두 파일 모두 확인했어요', widgets: null, toolCalls: null, createdAt: '2026-10-08T00:00:01Z' },
    {
      id: 3, role: 'USER', content: '메모도요', widgets: null, toolCalls: null, createdAt: '2026-10-08T00:00:02Z',
      attachments: [createHomeAttachment({ fileId: 79, messageId: 3, originalName: 'memo.txt', mimeType: 'text/plain', sizeBytes: 40 })],
    },
  ] satisfies HomeMessage[])
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-w/messages', [
    { id: 9, role: 'USER', content: '다른 질문', widgets: null, toolCalls: null, createdAt: '2026-10-07T00:00:00Z' },
  ] satisfies HomeMessage[])
  const re = /^\/api\/v1\/home\/sessions\/s-v\/attachments\/(\d+)\/content$/
  const tracker = trackRequests(page, 'GET', re)
  const content: Record<number, { type: string; body: Buffer }> = {
    77: { type: 'image/png', body: PNG },
    78: { type: 'application/pdf', body: PDF },
    79: { type: 'text/plain', body: Buffer.from(MEMO_TEXT, 'utf-8') },
  }
  await page.route((u) => re.test(u.pathname), (r) => {
    const c = content[Number(re.exec(new URL(r.request().url()).pathname)?.[1])]
    return c ? r.fulfill({ status: 200, contentType: c.type, body: c.body }) : r.fulfill({ status: 404, body: '' })
  })
  return tracker
}
