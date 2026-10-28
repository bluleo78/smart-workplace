// 위키 백엔드 DTO 미러.

export type WikiRole = 'OWNER' | 'EDITOR' | 'VIEWER'
export type WikiSpaceType = 'PERSONAL' | 'TEAM'

export interface WikiSpace {
  id: number
  type: WikiSpaceType
  name: string
  ownerId: number
  role: WikiRole
  createdAt: string
}

export interface WikiMember {
  userId: number
  name: string
  role: WikiRole
}

/**
 * 스페이스 멤버인 조직도 부서(WP-1052) — 부서 자체가 멤버라 그 부서와 하위 부서의 지금 구성원이 이 역할을 받는다.
 * 역할은 편집자·보기 전용만(소유자 불가 — 멤버 관리 권한을 부서 전체에 주지 않는다). memberCount 는 하위 포함 활성 사람 수(중복 제외).
 */
export interface WikiMemberGroup {
  groupId: number
  name: string
  role: Exclude<WikiRole, 'OWNER'>
  memberCount: number
}

export interface WikiPageSummary {
  id: number
  parentId: number | null
  title: string
  position: number
  // #736: AI 생성 attribution — 값 존재 여부만으로 사이드바 트리 배지를 판단(null 이면 AI 이력 없음).
  aiLastUsedAt: string | null
  // WP-579: 이 페이지 자신의 공유(없으면 null) — 사이드바 트리 공유 아이콘과, 하위 포함 공유 안팎으로 옮길 때 경고에 쓴다.
  share?: WikiTreeShare | null
  // WP-1031: 이 페이지에 상위 공유 제외 표시(WP-987)가 있는지 — 있으면 그 위의 하위 포함 공유로 열리지 않는다. 이동 경고가 상속을 여기서 멈춘다.
  shareExcluded?: boolean
}

/** 트리에 실린 공유 요약(WP-579). */
export interface WikiTreeShare {
  audience: WikiShareAudience
  includeChildren: boolean
  // WP-1043: 만료 시각이 지났는지 — 만료된 자기 공유는 위 공유의 상속을 멈추지 않는다(서버 접근 판정과 같게 이동 경고·아이콘이 따른다).
  expired?: boolean
}

export interface WikiPageDetail {
  id: number
  spaceId: number
  parentId: number | null
  title: string
  body: string
  version: number
  updatedBy: number | null
  updatedAt: string
  // #736: 페이지 단위 AI 생성 attribution(마지막 사용 시각/액션). 둘 다 null 이면 AI 이력 없음.
  aiLastUsedAt: string | null
  aiLastAction: string | null
  // WP-579: 이 페이지 자신이 링크로 공유 중인지 — 헤더 「공유 중」 표시. 설정 내용은 공유 창을 열 때 따로 받는다.
  shared?: boolean
  // WP-793: 본문을 읽기 폭(768px) 대신 화면 폭 전체로 펼친다 — 페이지에 저장돼 여는 모든 사람에게 같다. 구버전 서버엔 없어 기본 false.
  fullWidth?: boolean
}

// 멘션 참조 종류 — 본문 토큰(<@id>·<#page:id>·<#issue:id>) 의 대상 타입.
// 값은 공용 스키마 패키지가 원본(동기화 서버와 공유) — 웹은 재수출해 기존 import 경로를 유지한다.
import type { WikiMentionType } from '@smart-workplace/wiki-editor-schema'
export type { WikiMentionType }

// 페이지 본문에 등장하는 멘션을 라벨/링크 정보로 해소한 참조(백엔드 1:1).
export interface WikiMentionRef {
  type: WikiMentionType
  id: number
  /** 공유 링크로 들어온 사람이 볼 수 없는 대상(inaccessible)이면 null — 제목·이름을 싣지 않는다(WP-579). */
  label: string | null
  spaceId: number | null
  projectKey: string | null
  number: number | null
  /** 공유 링크로 들어온 사람이 볼 수 없는 대상 — 칩이 링크 없는 「접근 권한 없음」으로 보인다(WP-579). */
  inaccessible: boolean
}

// 백링크 — 이 페이지를 참조(멘션)하는 다른 위키 페이지(백엔드 1:1).
export interface WikiBacklink {
  pageId: number
  spaceId: number
  spaceName: string
  title: string
  updatedAt: string
}

export interface WikiBacklinksResponse {
  items: WikiBacklink[]
}

// 위키 검색 결과 한 건(S2, 백엔드 1:1). snippet 은 본문 앞부분 미리보기.
export interface WikiSearchResult {
  id: number
  spaceId: number
  spaceName: string
  title: string
  snippet: string
  updatedAt: string
}

// #751: 노트 본문 이미지 첨부 업로드 응답. url 은 그대로 마크다운에 삽입한다(클라이언트가 경로를 조립하지 않는다).
export type WikiAttachment = {
  fileId: number
  url: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

/** WP-301 노트 상단 AI 요약 상태(백엔드 WikiSummaryStatus). */
export type WikiSummaryStatus = 'READY' | 'STALE' | 'MISSING' | 'TOO_SHORT' | 'UNAVAILABLE'

/** WP-301 노트 요약 응답 — summaryVersion 은 요약 당시 노트 버전, pageVersion 은 응답 시점 버전. */
export interface WikiPageSummaryState {
  summary: string | null
  status: WikiSummaryStatus
  summaryVersion: number | null
  pageVersion: number
  summarizedAt: string | null
}

/** WP-282 버전 기록 — 스냅샷을 남긴 까닭(백엔드 RevisionReason). 옛 행은 null. */
export type WikiRevisionReason = 'SESSION' | 'PERIODIC' | 'AI' | 'RESTORE'

/** 버전 기록에 보이는 사람 — 편집자·AI 요청자(백엔드 WikiRevisionItem.Person). */
export interface WikiRevisionPerson {
  id: number
  name: string
}

/** 버전 기록 목록의 한 판(백엔드 WikiRevisionItem). aiActor 는 AI 적용 직전 스냅샷일 때만 요청자. */
export interface WikiRevisionItem {
  version: number
  title: string
  editedAt: string
  createdAt: string
  reason: WikiRevisionReason | null
  editors: WikiRevisionPerson[]
  aiActor: WikiRevisionPerson | null
}

/** 버전 기록 목록 응답(백엔드 WikiRevisionListResponse) — current 는 지금 판, items 는 최신순(최대 200). */
export interface WikiRevisionList {
  current: { version: number; editedAt: string; editors: WikiRevisionPerson[] }
  items: WikiRevisionItem[]
}

/** 한 판 본문(백엔드 WikiRevisionDetail) — body 는 마크다운. */
export interface WikiRevisionDetail extends WikiRevisionItem {
  body: string
}

/**
 * WP-579 페이지 공유 — 링크를 열 수 있는 사람. WORKSPACE = 같은 워크스페이스 멤버 누구나, PEOPLE = 지정한 사람만,
 * PUBLIC = 링크가 있는 누구나(외부, 로그인 없이 보기만 — 관리자가 외부 공유를 허용했을 때만).
 */
export type WikiShareAudience = 'WORKSPACE' | 'PEOPLE' | 'PUBLIC'
/** 공유받은 사람의 권한 — 보기만(VIEW) 또는 편집(EDIT). */
export type WikiSharePermission = 'VIEW' | 'EDIT'

/** 공유 설정에 보이는 사람(공유한 사람·지정한 사람). */
export interface WikiSharePerson {
  userId: number
  name: string
}

/**
 * 지정한 사람(PEOPLE) 공유의 대상 한 사람(WP-1063, 백엔드 WikiShareTargetPerson). active=false 면 정지·비활성 계정이라 지금 열 수
 * 없다(기준은 백엔드 WikiShareRepository.listPeople). 롤링 배포 중 이전 API 응답에는 없을 수 있어 선택 필드다 — 없으면 활성으로 본다.
 */
export interface WikiShareTargetPerson extends WikiSharePerson {
  active?: boolean
}

/**
 * 지정한 사람 공유가 여는 조직도 부서(WP-1023, 백엔드 WikiShareGroup) — 그 부서와 하위 부서의 지금 구성원이 열 수 있다.
 * memberCount 는 지금 열 수 있는 사람 수(하위 부서 포함·중복 제외·활성 사람만) — 공유 창이 「개발팀 · 3명」으로 보인다.
 */
export interface WikiShareGroup {
  groupId: number
  name: string
  memberCount: number
}

/** 한 페이지의 공유 설정(백엔드 WikiPageShareResponse). token 은 링크 주소에 들어가는 값 — 재발급하면 바뀐다. */
export interface WikiPageShare {
  pageId: number
  token: string
  audience: WikiShareAudience
  permission: WikiSharePermission
  includeChildren: boolean
  /** audience=PEOPLE 일 때 지정한 사람과 지금 열 수 있는지(WORKSPACE 면 빈 배열). */
  people: WikiShareTargetPerson[]
  /** audience=PEOPLE 일 때 지정한 조직도 부서(WP-1023, 그 밖에는 빈 배열). */
  groups: WikiShareGroup[]
  createdBy: WikiSharePerson
  createdAt: string
  updatedAt: string
  /** 만료 시각(없으면 무기한). 외부 링크는 처음 30일. */
  expiresAt: string | null
  /** 링크가 마지막으로 열린 시각·연 횟수. */
  lastAccessedAt: string | null
  viewCount: number
}

/** 공유를 기다리는 접근 요청(지정한 사람만 링크를 연 다른 멤버). */
export interface WikiShareAccessRequest {
  id: number
  requester: WikiSharePerson
  requestedAt: string
}

/**
 * 공유 창이 여는 상태(백엔드 WikiPageShareStateResponse) — 이 페이지 공유(없으면 null), 외부 공유 허용 여부(관리자 정책),
 * 상위 페이지 공유(하위 포함)로 이미 보이는지, 대기 중 접근 요청.
 */
export interface WikiPageShareState {
  share: WikiPageShare | null
  externalShareEnabled: boolean
  /**
   * 이 페이지가 상속받는 상위 페이지의 하위 포함 공유(WP-987) — 이 페이지가 제외 표시를 달았어도 온다(제외 체크를 풀 수 있게).
   * token 은 상위 공유의 지금 토큰 — 「이 페이지 링크 복사」가 `/wiki/share/<token>/pages/<이 페이지>` 를 만든다.
   */
  inheritedFrom: {
    pageId: number
    title: string
    audience: WikiShareAudience
    permission: WikiSharePermission
    token: string
  } | null
  accessRequests: WikiShareAccessRequest[]
  /** 이 페이지에 「이 페이지와 하위는 상위 공유에서 제외」 표시가 있는지(WP-987). */
  excludedFromParent: boolean
  /** 이 페이지의 하위 포함 공유에서 제외된 하위 페이지(WP-987) — 「제외: … [제외 풀기]」. */
  excludedPages: { pageId: number; title: string }[]
}

/** 공유 설정을 만들거나 바꾸는 요청 — PUT 은 없으면 만들고 있으면 덮어쓴다(토큰은 유지). */
export interface WikiPageShareRequest {
  audience: WikiShareAudience
  permission: WikiSharePermission
  includeChildren: boolean
  userIds: number[]
  /**
   * 지정한 조직도 부서 전체(WP-1023) — 보내지 않으면 서버가 지금 부서를 그대로 둔다(빈 배열이면 모두 뺀다).
   * 공유 창은 늘 지금 값을 함께 보낸다(바꾸지 않은 설정까지 덮어쓰는 PUT 이라).
   */
  groupIds?: number[]
  expiresAt: string | null
  /** 새로 추가한 사람에게 알림을 보낼지와 함께 보낼 메시지(선택, 최대 WIKI_SHARE_MESSAGE_MAX 자). */
  notify?: { message: string | null }
}

/** 공유 알림 메시지 상한(글자) — API WikiPageShareRequest.MESSAGE_MAX(채팅 메시지와 같은 4000자)와 같아야 한다. 넘기면 저장이 400. */
export const WIKI_SHARE_MESSAGE_MAX = 4000

/** 공유 기록 한 줄의 종류 — 만듦·설정 변경·사람 추가/제외·재발급·해제. */
export type WikiShareEventType =
  | 'CREATED'
  | 'UPDATED'
  | 'PEOPLE_ADDED'
  | 'PEOPLE_REMOVED'
  | 'GROUPS_ADDED'
  | 'GROUPS_REMOVED'
  | 'REGENERATED'
  | 'REVOKED'
  | 'REVOKED_BY_POLICY'
  | 'REVOKED_BY_ADMIN'
  | 'PAGE_MOVED_IN'
  | 'CHILD_EXCLUDED'
  | 'CHILD_INCLUDED'
  | 'PAGE_MOVED_OUT'
  | 'ACCESS_REQUESTED'
  | 'ACCESS_APPROVED'
  | 'ACCESS_DENIED'

/** 공유 기록(백엔드 WikiShareEventResponse) — detail 은 화면에 그대로 보이는 한 줄 요약. */
export interface WikiShareEvent {
  id: number
  type: WikiShareEventType
  actor: WikiSharePerson
  detail: string
  at: string
}

/** 스페이스에서 공유 중인 페이지 한 줄(공유 중인 페이지 목록). */
export interface WikiSharedPageItem {
  pageId: number
  title: string
  audience: WikiShareAudience
  permission: WikiSharePermission
  includeChildren: boolean
  peopleCount: number
  /** 지정한 조직도 부서 수(WP-1023, PEOPLE 이 아니면 0). */
  groupCount: number
  createdBy: WikiSharePerson
  updatedAt: string
  expiresAt: string | null
  lastAccessedAt: string | null
  viewCount: number
  /**
   * 링크 토큰(복사용) — 스페이스 목록은 EDITOR 미만 호출자에게 null(보기 권한만 있는 멤버가 편집 링크 토큰을 읽어 권한을 얻지 못하게).
   * 값이 없으면 링크 복사를 두지 않는다.
   */
  token: string | null
}

/** 스페이스를 가로지르는 공유 목록 한 줄(설정 › 내 공유, 관리자 › 노트 공유) — 스페이스와 링크 토큰(복사용)까지. */
export interface WikiShareListItem extends WikiSharedPageItem {
  spaceId: number
  spaceName: string
  // 내 공유·관리자 목록은 항상 값이 있다.
  token: string
}

/** 외부 보기 응답(로그인 없음) — 본문 마크다운은 서버가 내부 링크·멘션을 가린 뒤 준다. 사람 정보는 없다. */
export interface WikiPublicShare {
  workspaceName: string
  rootPageId: number
  pages: Pick<WikiPageSummary, 'id' | 'parentId' | 'title' | 'position'>[]
  // fullWidth(WP-793): 페이지 「전체 폭」 설정 — 외부 보기도 같은 폭으로 그린다.
  page: { id: number; title: string; markdown: string; updatedAt: string; fullWidth?: boolean }
}

/**
 * 공유 링크로 연 페이지 묶음(백엔드 WikiShareResolveResponse) — rootPageId 가 공유한 페이지,
 * pages 는 링크로 볼 수 있는 페이지 트리(하위 포함이 아니면 루트 하나).
 */
export interface WikiShareResolved {
  rootPageId: number
  spaceId: number
  permission: WikiSharePermission
  includeChildren: boolean
  sharedBy: WikiSharePerson
  /** 연 사람이 이 스페이스 멤버면 true — 원래 노트 화면으로 보낸다. */
  member: boolean
  pages: WikiPageSummary[]
}

/**
 * 알림에서 노트를 열 때 갈 곳(WP-579, 백엔드 WikiPageEntryResponse) — GET /wiki/pages/{id}/entry.
 * member 면 원래 노트 주소로, 아니면 shareToken(그 페이지를 덮는 공유의 지금 토큰)으로 공유 화면을 연다.
 */
export interface WikiPageEntry {
  spaceId: number
  member: boolean
  shareToken: string | null
}

/** 다른 워크스페이스의 공유 링크(409) 응답 본문 — 그 워크스페이스 멤버일 때만 온다. code·tenantId 는 최상위 필드다. */
export interface WikiShareOtherTenantError {
  code: 'WIKI_SHARE_OTHER_TENANT'
  tenantId: number
}

/** 지정한 사람이 아닌 사람이 공유 링크를 열 때(403) 응답 본문 — 링크는 유효해 이 응답이면 언제나 접근 요청을 보낼 수 있다. */
export interface WikiShareForbiddenError {
  requested: boolean
  /** 같은 공유에 24시간 안에 요청이 거절됐다 — 다시 요청해도 새 요청을 만들지 않는다. */
  denied: boolean
}

/**
 * 접근 요청 보내기 결과(POST /wiki/shares/{token}/access-requests) — PENDING(보냄·이미 대기 중),
 * DENIED(같은 공유에 24시간 안에 거절됨, 새 요청·알림 없음), NOT_NEEDED(요청할 필요 없음 — 이미 지정됨·스페이스 멤버 등).
 */
export interface WikiShareAccessRequestResult {
  status: 'PENDING' | 'DENIED' | 'NOT_NEEDED'
}

/** 옮기기 미리보기에 나오는 공유 루트 페이지. */
export interface WikiMoveSharedPage {
  pageId: number
  title: string
}

/** 다른 스페이스로 옮기기 미리보기(WP-988) — 옮기면 무엇이 바뀌는지 대화상자에 경고로 보인다. */
export interface WikiMovePreview {
  /** 함께 옮겨지는 페이지 수(하위 포함). */
  pageCount: number
  /** 옮기면 접근을 잃는 원본 스페이스 멤버 수(대상 스페이스 멤버가 아닌 사람). */
  lostMemberCount: number
  /** 옮기면 새로 볼 수 있게 되는 대상 스페이스 멤버 수(노출 범위가 넓어짐). */
  gainedMemberCount: number
  /** 같은 링크로 따라가는 공유. */
  keptShares: WikiMoveSharedPage[]
  /** 공유한 사람이 대상 스페이스 편집자가 아니라 해제되는 공유. */
  revokedShares: WikiMoveSharedPage[]
}
