// 드라이브 백엔드 DTO 와 1:1 매칭되는 TS 인터페이스.

// #76: CHANNEL = 메시징 채널에 연동된 공간.
export type DriveSpaceType = 'PERSONAL' | 'TEAM' | 'CHANNEL'
export type DriveRole = 'OWNER' | 'EDITOR' | 'VIEWER'

// #78: 공유 링크 가시성 — 외부(익명) / 사내(로그인).
export type ShareLinkAudience = 'EXTERNAL' | 'INTERNAL'

/**
 * 「공유받은 항목」 한 줄(WP-1539·WP-1540, GET /drive/shared-with-me) — 내가 연 사내 공유 링크로 받은 파일·폴더.
 * 공간·파일·폴더 id 는 오지 않는다 — 목록 행은 권한을 주지 않고, 열기·복사는 늘 링크 토큰으로 링크 규칙을 거친다.
 */
export interface SharedWithMeItem {
  /** 링크 id — 「목록에서 빼기」 대상이자 폴더 화면 주소(/drive/shared/:shareLinkId)의 키. */
  shareLinkId: number
  /** 항목 종류 — 파일 링크는 FILE, 폴더 링크는 FOLDER(WP-1540). */
  kind: 'FILE' | 'FOLDER'
  name: string
  /** 파일의 MIME — 폴더면 null. */
  mimeType: string | null
  /** 파일 크기(바이트) — 폴더면 null. */
  sizeBytes: number | null
  /** 폴더 직속 하위 폴더 수 — 열 수 있는 폴더 행에만 오고, 파일·열 수 없는 폴더면 null. */
  folderCount: number | null
  /** 폴더 직속 파일 수 — 열 수 있는 폴더 행에만 오고, 파일·열 수 없는 폴더면 null. */
  fileCount: number | null
  /** 항목이 있는 공간 이름(남의 개인 공간은 「○○의 드라이브」). */
  spaceName: string
  /** 링크를 만든 사람 이름 — 알 수 없으면 null. */
  sharedBy: string | null
  lastOpenedAt: string
  /** 링크가 살아 있고 파일·폴더가 휴지통에 없으면 true — false 면 「열 수 없음」. */
  openable: boolean
  hasPassword: boolean
  /** 열기·복사에 쓰는 링크 토큰 — 열 수 없거나 되살릴 수 없으면 null. */
  token: string | null
}

// #78: 공유 링크 목록 항목이자 생성 응답. WP-1528: 이미 만든 링크를 다시 복사할 수 있게 토큰을 함께 받고,
// 생성 응답도 같은 모양이라 공유 창이 서버 항목을 그대로 목록 맨 위에 넣는다.
export interface ShareLink {
  id: number
  audience: ShareLinkAudience
  hasPassword: boolean
  expiresAt: string | null
  revoked: boolean
  /** 지금 쓸 수 있는가 — 서버가 자기 시계로 판정(폐기되지 않았고 만료 전). 살아 있는/지난 링크 나눔은 이 값을 따른다. */
  active: boolean
  createdAt: string
  createdBy: number
  /** 랜딩 URL 토큰 — 이 변경 전에 만든 링크(해시만 저장)·복호화 실패·해시 불일치, 그리고 폐기·만료된 링크는 null(URL 을 다시 보여 줄 수 없다). */
  token: string | null
  /** 만든 사람 이름 — 탈퇴 등으로 알 수 없으면 null. */
  createdByName: string | null
}

export interface DriveSpace {
  id: number
  type: DriveSpaceType
  name: string
  ownerId: number
  role: DriveRole
  // #76: 보관된 채널에 연동된 공간은 archived=true → 읽기 전용 처리.
  archived: boolean
  createdAt: string
}

export interface DriveMember {
  userId: number
  name: string
  role: DriveRole
  // 멤버 부서로 받는 역할(WP-1102) — 직접 역할보다 높을 때만 서버가 싣는다(WP-1166), 아니면 null.
  departmentRole?: Exclude<DriveRole, 'OWNER'> | null
}

/**
 * 팀 스페이스 멤버인 조직도 부서(WP-1056) — 부서 자체가 멤버라 그 부서와 하위 부서의 지금 구성원이 이 역할을 받는다(노트 WikiMemberGroup 과 같은 모양).
 * 역할은 편집자·보기 전용만(소유자 불가). memberCount 는 하위 포함 활성 사람 수(중복 제외).
 */
export interface DriveMemberGroup {
  groupId: number
  name: string
  role: Exclude<DriveRole, 'OWNER'>
  memberCount: number
}

export interface DriveFolder {
  id: number
  parentId: number | null
  name: string
  createdAt: string
  // #799: 목록 3열(이름/크기/수정일) — 이름변경/이동 시 갱신.
  updatedAt: string
}

/** breadcrumb 세그먼트 — 백엔드 DriveFolderPathSegment 와 1:1. 루트→대상 순. */
export interface DriveFolderPathSegment {
  id: number
  name: string
}

export interface DriveFile {
  id: number
  folderId: number | null
  fileId: number
  name: string
  mimeType: string
  sizeBytes: number
  category: string
  createdAt: string
  // #799: 목록 3열(이름/크기/수정일) — 버전 업로드/이름변경/이동 시 갱신.
  updatedAt: string
  // #79: 버전 수 — 업로드/롤백 시 갱신.
  versionCount: number
  // #739: 디스크 원본(blob) 존재 여부 — 읽기 시점 판정. false = 유실(복구 불가).
  available: boolean
}

// #79: 드라이브 파일 버전 — 백엔드 DriveFileVersionResponse 와 1:1.
export interface DriveFileVersion {
  versionNo: number
  fileId: number
  sizeBytes: number
  uploadedBy: number
  uploadedByName: string
  createdAt: string
  comment: string | null
  current: boolean
}

export interface DriveItemList {
  folders: DriveFolder[]
  files: DriveFile[]
}

/** 검색 결과 파일/폴더 — 백엔드 DriveFileHit/DriveFolderHit 와 1:1. folderPath = 조상 폴더 경로. */
export interface DriveFileHit extends DriveFile {
  folderPath: string
}

export interface DriveFolderHit extends DriveFolder {
  folderPath: string
}

export interface DriveSearchResult {
  folders: DriveFolderHit[]
  files: DriveFileHit[]
}

/** 휴지통 항목 — 백엔드 DriveTrashItemResponse 와 1:1. type: 'FOLDER'|'FILE'. */
export interface DriveTrashItem {
  type: 'FOLDER' | 'FILE'
  id: number
  name: string
  originalPath: string
  trashedAt: string
  autoPurgeAt: string
  sizeBytes: number | null
}

export interface DriveTrashList {
  items: DriveTrashItem[]
}

// #80: 드라이브 교차링크 — 이슈↔드라이브 파일 연결.

/** 드라이브 링크 가용성 — 파일이 활성/휴지통/삭제 상태인지. */
export type LinkAvailability = 'ACTIVE' | 'TRASHED' | 'DELETED'

/** 이슈에 연결된 드라이브 파일 링크 (백엔드 DriveLinkResponse 1:1). */
export interface DriveLink {
  driveFileId: number
  fileId: number
  name: string
  mimeType: string
  sizeBytes: number
  hasThumbnail: boolean
  spaceId: number
  spaceName: string
  availability: LinkAvailability
  createdById: number
  createdAt: string
}

/** 드라이브 파일이 참조된 출처 — 이슈 또는 메시지. */
export interface Backlink {
  sourceType: 'ISSUE' | 'MESSAGE'
  sourceId: number
  label: string
  deepLink: string
}

/** 가상 첨부의 출처 종류 — 백엔드 AttachmentSourceProvider.sourceType() 과 같은 값. 노트(WIKI)·내 메일(MAIL)은 WP-1392 에서 추가. */
export type VirtualAttachmentSource = 'ISSUE' | 'CHAT_MESSAGE' | 'MESSAGE' | 'WIKI' | 'MAIL'

/** 이슈/이슈챗/메시지/노트에서 업로드된 파일과 내 메일 첨부를 드라이브 가상 첨부로 표현한 DTO. */
export interface VirtualAttachment {
  /** core 파일 id — 메일 첨부(MAIL)는 file 행이 없어 null 이고 mailAttachmentId 로 가리킨다(WP-1392). */
  fileId: number | null
  name: string
  mimeType: string
  sizeBytes: number
  hasThumbnail: boolean
  /** 출처 — 이슈 첨부·이슈챗(CHAT_MESSAGE) 첨부·채팅 메시지 첨부(WP-1391 에서 이슈챗 추가). */
  sourceType: VirtualAttachmentSource
  sourceLabel: string
  deepLink: string
  downloadUrl: string
  attachedAt: string
  /** 같은 출처 안의 세부 종류 — 이슈 본문 이미지면 "BODY_IMAGE", 그 밖엔 null. 예전 서버 응답에는 없다(WP-1392). */
  kind?: string | null
  /** 메일 첨부 id(email_attachment) — MAIL 일 때만 값이 있고, 미리보기·내려받기 경로를 만든다(WP-1392). */
  mailAttachmentId?: number | null
}

/** 가상 첨부 cursor 페이지. */
export interface VirtualAttachmentPage {
  items: VirtualAttachment[]
  nextCursor: string | null
}

/**
 * 저장 공간 종류별 내역(WP-1391) — 단위 바이트. 한 파일은 한 종류로만 세므로 합이 usedBytes 와 같다.
 * - drive: 휴지통이 아닌 드라이브 파일(옛 버전 포함) · trash: 휴지통
 * - wiki: 노트 첨부 · issue: 이슈 첨부·본문 이미지 · issueChat: 이슈챗 첨부
 * - otherAttachments: 채팅·홈·메일 초안 첨부(보낸 메일 사본 포함) · unlinked: 올리는 중·임시(어디에도 안 묶인 파일)
 */
export interface DriveQuotaBreakdown {
  drive: number
  trash: number
  wiki: number
  issue: number
  issueChat: number
  otherAttachments: number
  unlinked: number
}

/** 드라이브 쿼터 — 백엔드 DriveQuotaResponse 와 1:1. */
export interface DriveQuota {
  usedBytes: number
  quotaBytes: number
  /** 종류별 내역 — 롤링 배포 중 옛 API 는 주지 않으므로 옵셔널(없으면 합계만 보인다). */
  breakdown?: DriveQuotaBreakdown
  /** 메일 첨부 임시 보관 바이트 — 한도에 넣지 않고 보여 주기만 한다. 옛 API 면 없다. */
  mailCacheBytes?: number
}

// #82: 벌크 선택 — fileIds + folderIds 를 함께 다루는 공통 DTO.
export interface BulkSelection {
  fileIds: number[]
  folderIds: number[]
}

// #82: 벌크 이동 — 선택 항목을 targetFolderId(null=루트) 로 이동.
export interface BulkMoveBody extends BulkSelection {
  targetFolderId: number | null
}

/**
 * 재생 주소 발급 응답(WP-1532) — 백엔드 DrivePlaybackUrlResponse 와 1:1.
 * url 은 같은 출처 상대 경로(`/api/v1/public/drive/playback/{token}`)라 `<video src>` 에 그대로 넣는다.
 */
export interface DrivePlaybackUrl {
  url: string
  expiresAt: string
  mimeType: string
}

/**
 * 나눠 올리기 세션(WP-1520) — 백엔드 upload-sessions 응답과 1:1.
 * 20MB 초과 파일을 chunkSize 조각으로 이어 올릴 때, 서버가 지금까지 받은 바이트(receivedBytes)를 알려 끊긴 자리부터 잇게 한다.
 */
export interface DriveUploadSession {
  id: string
  chunkSize: number
  receivedBytes: number
  size: number
  expiresAt: string
}

/** 나눠 올리기 세션 시작 요청 본문 — folderId 가 없으면 공간 루트. */
export interface DriveUploadSessionStartBody {
  folderId?: number
  fileName: string
  contentType?: string
  size: number
}
