// 앱 링크 빌더(WP-1234) — 상세 화면의 「링크 복사」·⇧⌘,·공유 시트가 같은 절대 주소를 만든다.
// 왜 지금 origin 인가: 같은 앱 구성원끼리 여는 링크이고 PWA(데스크톱 앱·홈 화면 앱)도 같은 origin 이라,
// 서버가 알려 준 공개 호스트(appLinks.ts)를 기다릴 필요 없이 지금 주소창의 origin 이 곧 앱 주소다.
// 드라이브 파일 경로는 뷰어의 driveFilePath(components/viewer/driveOpen.ts)를 그대로 쓴다 — ?preview 규칙을 한 곳에 둔다.

/**
 * 앱 안 경로를 절대 URL 로 바꾼다. 이미 절대 URL 이면 그대로 둔다(행 메뉴의 linkFor 가 절대 주소를 줄 수 있다).
 */
export function appUrl(path: string): string {
  return new URL(path, window.location.origin).href
}

/** 이슈 상세 경로 — /projects/:key/issues/:n. */
export function issuePath(projectKey: string, issueNumber: number): string {
  return `/projects/${projectKey}/issues/${issueNumber}`
}

/** 노트 페이지 경로 — 스페이스를 몰라도 열리는 /wiki/open/:pageId(WikiOpenPage 가 스페이스를 찾아 연다). */
export function wikiPagePath(pageId: number): string {
  return `/wiki/open/${pageId}`
}

/** 드라이브 폴더 경로 — 공간 루트(folderId 없음)면 쿼리를 붙이지 않는다. */
export function driveFolderPath(spaceId: number, folderId: number | null): string {
  return folderId == null ? `/drive/spaces/${spaceId}` : `/drive/spaces/${spaceId}?folderId=${folderId}`
}

/** 일정 상세 경로 — 캘린더가 ?eventId 로 일정 대화상자를 연다. 반복 일정은 회차가 아니라 시리즈(마스터 id)가 열린다. */
export function calendarEventPath(eventId: number): string {
  return `/calendar?eventId=${eventId}`
}

/** 메일 상세 경로 — 계정 화면에서 ?messageId 로 메일을 연다. */
export function mailMessagePath(accountId: number, messageId: number): string {
  return `/mail/${accountId}?messageId=${messageId}`
}

/**
 * 채널·DM 메시지 경로(WP-1236) — 대화 화면이 ?message 로 그 메시지까지 거슬러 올라가 강조한다.
 * 스레드 답글은 ?thread(루트)도 붙여 스레드 패널을 함께 연다 — 답글은 본 대화 목록에 없다.
 */
export function chatMessagePath(target: {
  channelId: number
  dm: boolean
  messageId: number
  threadRootId?: number | null
}): string {
  const base = `/chat/${target.dm ? 'dms' : 'channels'}/${target.channelId}`
  const thread = target.threadRootId != null && target.threadRootId !== target.messageId ? `thread=${target.threadRootId}&` : ''
  return `${base}?${thread}message=${target.messageId}`
}
