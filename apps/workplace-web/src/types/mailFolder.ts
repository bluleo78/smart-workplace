// 서버 메일함(보관·내 메일함) DTO — 백엔드 com.workplace.mail.dto.MailFolderResponse·MailFolderSyncResult 와 1:1(WP-960).
// 받은편지함·보낸편지함은 기존 고정 항목(MailFolder 'INBOX'|'SENT')이 맡고, 여기엔 보관(ARCHIVE)과 사용자 메일함(USER)만 온다.

/** 서버 메일함 역할 — 보관 또는 사용자가 만든 메일함. */
export type MailServerFolderRole = 'ARCHIVE' | 'USER';

/** 사이드바 트리용 서버 메일함 한 개. 트리는 parentId 로 웹이 조립한다(lib/mailFolders). */
export interface MailServerFolder {
  id: number;
  displayName: string;
  /** 보이는 부모 메일함 id — 최상위면 null. */
  parentId: number | null;
  role: MailServerFolderRole;
  /** false 면 메일을 담지 못하고 하위 메일함만 묶는 노드(열 수 없다). */
  selectable: boolean;
  /** 서버 안 읽은 수 — 모르면 null(0 과 다르다). */
  unreadCount: number | null;
  totalCount: number | null;
  /** 가져온 가장 오래된 수신일 경계 — 아직 안 가져왔으면 null. */
  syncedSince: string | null;
  /** 이 메일함을 마지막으로 가져온 시각 — 없으면 null. */
  folderSyncedAt: string | null;
}

/** 메일함 한 개 동기화 결과. running=true 면 이미 가져오는 중이라 이번 요청은 아무것도 하지 않았다(오류 아님). */
export interface MailFolderSyncResult {
  running: boolean;
  fetched: number;
  saved: number;
  seenChanged: number;
  removed: number;
  syncedSince: string | null;
  folderSyncedAt: string | null;
}

/** WP-962 메일 옮기기 대상 종류 — 받은편지함·보관·서버 휴지통(삭제)·저장된 서버 메일함(folderId). */
export type MailMoveTargetKind = 'INBOX' | 'ARCHIVE' | 'TRASH' | 'FOLDER';

/** WP-962 메일 옮기기 대상 — 백엔드 MailMoveRequest.Target 과 1:1. FOLDER 일 때만 folderId. */
export interface MailMoveTarget {
  kind: MailMoveTargetKind;
  folderId?: number;
}

/** WP-962 메일 옮기기 요청 — 백엔드 MailMoveRequest 와 1:1(1~100통). */
export interface MailMoveRequest {
  messageIds: number[];
  target: MailMoveTarget;
}

/** WP-962 메일 옮기기 결과 — 메일별 성공 여부. 실패한 메일은 서버·앱 모두 그대로다. */
export interface MailMoveResponse {
  results: { messageId: number; ok: boolean; error: string | null }[];
}
