// 화면별 데이터 → ViewerItem 어댑터와 묶음 해석(WP-277). 순수 함수만 둔다(vitest 대상).
import { attachmentContentPath } from '../../api/issueAttachments'
import { homeAttachmentContentPath } from '../../lib/homeChatAttachments'
import { canonicalMime, isGenericMime, mimeFromFilename } from '../../lib/mimeFromFilename'
import type { IssueAttachment } from '../../types/attachment'
import type { DriveFile, DriveLink, VirtualAttachment } from '../../types/drive'
import type { HomeUploadedFile } from '../../types/home'
import type { EmailAttachmentMeta } from '../../types/mailMessage'
import type { MessageAttachment } from '../../types/messaging'
import type { ViewerItem } from './types'

/** 묶음 키 — 드라이브 파일·링크는 `drive:{driveFileId}`, 그 외 첨부는 `file:{fileId}`(URL ?preview 값). */
export const driveViewerKey = (driveFileId: number) => `drive:${driveFileId}`
export const fileViewerKey = (fileId: number) => `file:${fileId}`

/** 묶음 키 형식(`file:{숫자}`·`drive:{숫자}`) — 만드는 쪽(위 두 함수)과 읽는 쪽(parseViewerKey)이 같은 규칙을 쓴다. */
const VIEWER_KEY_RE = /^(file|drive):(\d+)$/

/**
 * 묶음 키 → 종류·숫자 id. 형식이 아니면(null·다른 용도의 ?preview 값) null.
 * 왜: 호출부가 접두어를 문자열로 자르거나 정규식을 따로 들고 있지 않게(키 형식이 바뀌어도 여기만 고친다).
 */
export function parseViewerKey(key: string | null): { kind: 'file' | 'drive'; id: number } | null {
  const m = key == null ? null : VIEWER_KEY_RE.exec(key)
  return m ? { kind: m[1] as 'file' | 'drive', id: Number(m[2]) } : null
}

/**
 * 메일 첨부 키 `mail:{attachmentId}` — 메일 첨부 id 는 core fileId 가 아니라 `file:` 와 네임스페이스를 나눈다.
 * parseViewerKey(file·drive) 와 따로 둔 이유: 드라이브·이슈 호스트가 그 파싱 결과를 "자기 키"로 보므로 메일 키가 섞이면 안 된다.
 */
export const mailViewerKey = (attachmentId: number) => `mail:${attachmentId}`
const MAIL_KEY_RE = /^mail:\d+$/
/** ?preview 값이 메일 첨부 키인지 — 메일 화면이 다른 용도의 ?preview 를 "찾을 수 없음"으로 안내하지 않게. */
export const isMailViewerKey = (key: string | null): boolean => key != null && MAIL_KEY_RE.test(key)

/**
 * 메일 첨부 형식 — 파라미터·대소문자·별칭(application/x-pdf·image/jpg 등)을 정규화한다.
 * 왜: IMAP 경로는 파라미터를 떼서 저장하지만 Graph 경로는 원문 그대로라, resolvePreviewKind 의 정확 일치가 빗나가지 않게.
 * 비었거나 범용 형식(octet-stream·force-download 등)이면 파일명 확장자로 추론한다 — 메일 클라이언트가 PDF·이미지도
 * 범용 형식으로 보내는 일이 많아 그대로 두면 미리보기가 안 된다. 서버가 준 구체적인 형식은 그대로 믿는다. 추론도 안 되면 octet-stream.
 * 메일 첨부 칩의 형식 아이콘도 이 값을 써서 칩과 뷰어가 같은 형식으로 보이게 한다.
 */
export function mailAttachmentMime(a: EmailAttachmentMeta): string {
  return attachmentMime(a.contentType, a.filename)
}

/**
 * 첨부 형식 일반 규칙(WP-280 메일 → WP-279 채팅 공용) — 구체적인 형식은 정규화만, 비었거나 범용이면 파일명 확장자로 추론, 그래도 모르면 octet-stream.
 * 왜: 팀 채팅 업로드는 브라우저가 보낸 Content-Type 을 원문 저장해(MimeNormalizer 미적용) octet-stream·파라미터가 섞일 수 있다.
 * SVG 는 추론하지 않는다(mimeFromFilename 규칙 — 범용 바이트를 SVG 로 달지 않음).
 */
export function attachmentMime(contentType: string | null | undefined, filename: string | null | undefined): string {
  if (!isGenericMime(contentType)) return canonicalMime(contentType)
  return mimeFromFilename(filename) ?? 'application/octet-stream'
}

/** 메일 첨부 표시·저장 이름 — 첨부 칩과 뷰어(제목·접근 이름·저장 파일명)가 같은 이름을 쓰게 한 곳에 둔다. */
export const mailAttachmentName = (a: EmailAttachmentMeta) => a.filename || `attachment-${a.id}`

/**
 * 메일 첨부 — 소유자 전용 콘텐츠 경로로 받고 내려받기도 같은 경로다.
 * ✨(요약)·☁(메일 첨부 가져오기 API 없음)·원본 이동(이미 메일 안)은 두지 않는다.
 * 이름이 없으면 예전 다운로드 버튼과 같은 `attachment-{id}` 로 저장되게 한다.
 */
export function mailAttachmentItem(a: EmailAttachmentMeta): ViewerItem {
  const path = `/mail/attachments/${a.id}/content`
  return {
    key: mailViewerKey(a.id),
    name: mailAttachmentName(a),
    mimeType: mailAttachmentMime(a),
    sizeBytes: a.sizeBytes,
    contentPath: path,
    downloadPath: path,
  }
}

/** 드라이브 화면의 파일 — 요약·참조된 곳을 쓰고, 이미 드라이브라 가져오기는 없다. */
export function driveFileItem(f: DriveFile): ViewerItem {
  return {
    key: driveViewerKey(f.id),
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    contentPath: `/drive/files/${f.id}/content`,
    downloadPath: `/drive/files/${f.id}/download`,
    summaryDriveFileId: f.id,
    backlinksDriveFileId: f.id,
  }
}

/** 첨부 모아보기의 가상 첨부 — 서버가 준 downloadUrl 로 받고, 원본(이슈·메시지)으로 이동할 수 있다. */
export function virtualAttachmentItem(a: VirtualAttachment): ViewerItem {
  return {
    key: fileViewerKey(a.fileId),
    name: a.name,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    contentPath: a.downloadUrl,
    downloadPath: a.downloadUrl,
    importFileId: a.fileId,
    sourceLink: a.deepLink,
  }
}

/** 이슈 업로드 첨부 — 멤버 권한 콘텐츠 경로. 다운로드도 같은 엔드포인트라(api downloadAttachment 와 동일) 경로를 같이 쓴다. */
export function issueAttachmentItem(projectKey: string, number: number, a: IssueAttachment): ViewerItem {
  const path = attachmentContentPath(projectKey, number, a.fileId)
  return {
    key: fileViewerKey(a.fileId),
    name: a.originalName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    contentPath: path,
    downloadPath: path,
    importFileId: a.fileId,
  }
}

/**
 * 이슈에 링크된 드라이브 파일 — 링크 전용 콘텐츠 경로(열람자가 그 드라이브 공간 권한이 없어도 이슈 권한으로 받음).
 * 요약은 드라이브 권한 API 라 403 일 수 있다 → 뷰어가 403 이면 ✨ 를 숨긴다.
 */
export function issueDriveLinkItem(projectKey: string, number: number, l: DriveLink): ViewerItem {
  return driveLinkItem(driveViewerKey(l.driveFileId), `/projects/${projectKey}/issues/${number}/drive-links/${l.driveFileId}/content`, l)
}

/**
 * 드라이브 링크 공통 항목(이슈·팀 채팅·이슈 채팅) — 화면마다 다른 것은 키와 링크 전용 콘텐츠 경로뿐이다.
 * 활성 링크만 ✨(요약)·드라이브에서 열기를 건다. 원본이 휴지통·삭제면 unavailable — 열어도 볼 수 없는 곳(요약 없음·not-found)으로 보내지 않게.
 * ☁(가져오기)는 없다 — 이미 드라이브 파일이다.
 */
function driveLinkItem(key: string, path: string, l: DriveLink): ViewerItem {
  const unavailable = l.availability !== 'ACTIVE'
  return {
    key,
    name: l.name,
    mimeType: l.mimeType,
    sizeBytes: l.sizeBytes,
    contentPath: path,
    downloadPath: path,
    ...(unavailable
      ? {}
      : { summaryDriveFileId: l.driveFileId, driveOpen: { spaceId: l.spaceId, driveFileId: l.driveFileId, name: l.name } }),
    unavailable,
  }
}

/**
 * 채팅 업로드 첨부 공통 항목 — 콘텐츠 경로로 받고 내려받기도 같은 경로(감사 경로 없음).
 * importable 이면 ☁ 드라이브로 가져오기(core fileId — 메시지·이슈 채팅 첨부 소스 프로바이더가 권한을 검사).
 * 원본으로 이동(sourceLink)은 두지 않는다 — 이미 그 메시지를 보고 있는 화면에서 연다.
 */
function chatUploadItem(key: string, path: string, a: HomeUploadedFile, importable: boolean): ViewerItem {
  return {
    key,
    name: a.originalName,
    mimeType: attachmentMime(a.mimeType, a.originalName),
    sizeBytes: a.sizeBytes,
    contentPath: path,
    downloadPath: path,
    ...(importable ? { importFileId: a.fileId } : {}),
  }
}

/**
 * 채팅 묶음 키 — `{표면}:{메시지}:{file|drive}:{id}`.
 * 묶음은 한 메시지 안이지만 같은 드라이브 파일이 여러 메시지에 링크될 수 있어 메시지 id 를 넣는다.
 * 표면 접두어(팀 `msg`·이슈 채팅 `cmsg`·메인 AI `turn`)를 나눠 서로 다른 테이블의 같은 메시지 id 가 겹치지 않게 하고,
 * `file:`/`drive:`/`mail:` 로 시작하지 않아 드라이브·이슈·메일 호스트 파서(parseViewerKey·isMailViewerKey)에 잡히지 않는다.
 */
const chatViewerKey = (surface: 'msg' | 'cmsg' | 'turn', messageId: number, itemKey: string) => `${surface}:${messageId}:${itemKey}`

/** 팀 채팅 업로드 첨부 — 채널 멤버 권한 메시지 첨부 경로. 형식은 원문 저장이라 범용이면 파일명으로 추론한다. */
export function teamChatAttachmentItem(channelId: number, a: MessageAttachment): ViewerItem {
  return chatUploadItem(
    chatViewerKey('msg', a.messageId, fileViewerKey(a.fileId)),
    `/messaging/channels/${channelId}/messages/${a.messageId}/attachments/${a.fileId}/content`,
    a,
    true,
  )
}

/** 팀 채팅 메시지에 링크된 드라이브 파일 — 채널 권한으로 받는 링크 전용 경로. */
export function teamChatDriveLinkItem(channelId: number, messageId: number, l: DriveLink): ViewerItem {
  return driveLinkItem(
    chatViewerKey('msg', messageId, driveViewerKey(l.driveFileId)),
    `/messaging/channels/${channelId}/messages/${messageId}/drive-links/${l.driveFileId}/content`,
    l,
  )
}

/** 이슈 채팅 업로드 첨부 — 스레드 메시지 첨부 경로. */
export function issueChatAttachmentItem(threadId: number, a: MessageAttachment): ViewerItem {
  return chatUploadItem(
    chatViewerKey('cmsg', a.messageId, fileViewerKey(a.fileId)),
    `/chat/threads/${threadId}/messages/${a.messageId}/attachments/${a.fileId}/content`,
    a,
    true,
  )
}

/** 이슈 채팅 메시지에 링크된 드라이브 파일 — 이슈 권한으로 받는 링크 전용 경로. */
export function issueChatDriveLinkItem(threadId: number, messageId: number, l: DriveLink): ViewerItem {
  return driveLinkItem(
    chatViewerKey('cmsg', messageId, driveViewerKey(l.driveFileId)),
    `/chat/threads/${threadId}/messages/${messageId}/drive-links/${l.driveFileId}/content`,
    l,
  )
}

/**
 * 메인 AI 채팅 첨부 — 세션 소유자 전용 경로. 턴에는 메시지 id 가 없어 턴 위치를 키에 넣는다.
 * ✨(업로드 요약 없음)·☁(세션 첨부 가져오기 API 없음)·원본 이동은 없다.
 */
export function homeChatAttachmentItem(sessionId: string, turnIndex: number, a: HomeUploadedFile): ViewerItem {
  return chatUploadItem(chatViewerKey('turn', turnIndex, fileViewerKey(a.fileId)), homeAttachmentContentPath(sessionId, a.fileId), a, false)
}

/**
 * 첨부 모아보기 ?preview 값 정규화 — 예전 형식(숫자 fileId, `?preview=123`)을 지금 키(`file:123`)로 읽는다.
 * 왜: 이전 버전이 만든 딥링크·북마크가 "찾을 수 없음"으로 떨어지지 않게(읽을 때만 바꾸고 URL 은 건드리지 않는다).
 */
export function normalizeAttachmentPreviewKey(value: string | null): string | null {
  return value != null && /^\d+$/.test(value) ? fileViewerKey(Number(value)) : value
}

/** 이슈 본문 이미지 — 이미 받은 blob 이 있으면 타입·크기를 그대로 쓴다. */
export function issueBodyImageItem({ src, fileId, alt, blob }: { src: string; fileId: number; alt: string; blob: Blob | null }): ViewerItem {
  return {
    key: fileViewerKey(fileId),
    name: alt || 'image',
    mimeType: blob?.type || 'image/png',
    sizeBytes: blob?.size ?? null,
    contentPath: src,
    downloadPath: src,
  }
}

/**
 * URL 의 현재 키 → 열 묶음과 위치.
 * 목록에 있으면 목록 전체가 묶음, 목록에서 빠졌으면(필터 변경·딥링크·실시간 삭제) 클릭 스냅숏 1건 묶음.
 * 왜: 열린 뷰어가 목록 재조회로 다른 파일로 바뀌거나 사라지지 않게 한다(드라이브 previewSnap 패턴 일반화).
 */
export function resolveBundle(
  items: ViewerItem[],
  currentKey: string | null,
  snapshot: ViewerItem | null,
): { items: ViewerItem[]; index: number } | null {
  if (currentKey == null) return null
  const index = items.findIndex((i) => i.key === currentKey)
  if (index >= 0) return { items, index }
  if (snapshot?.key === currentKey) return { items: [snapshot], index: 0 }
  return null
}
