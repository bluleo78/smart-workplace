// 감사 로그 액션/리소스 enum ↔ 한글 라벨 — AuditLogListPage 의 순수 매핑(WP-412 에서 페이지 밖으로 분리).
// 백엔드에 새 이벤트가 추가되면 여기 목록에 라벨을 더한다(누락 시 raw enum 노출 + 콘솔 경고, #109·#778).

/**
 * 액션 유형 옵션 목록
 * - 백엔드(AuditLogService.log) 호출부에서 사용 중인 enum 전수: CREATE/UPDATE/DELETE/LOGIN/LOGOUT/IMPORT/EXECUTE/DATA_EXPORT/STATUS_CHANGE
 * - #109 회귀: DATA_EXPORT, STATUS_CHANGE 매핑 누락 보강.
 * - #778 회귀: PAT(UserApiTokenService)/AGENT 키(AgentApiKeyService)/AGENT OAuth 자격증명(AiAgentCredentialService)/
 *   운영자 콘솔(PlatformAuthService)/AGENT 유저 CRUD·구성원 생성(UserService)/드라이브 파일(DriveFileService/DriveBulkService/DriveShareLinkService)
 *   호출부에서 최근 추가된 값 보강.
 * - WP-369: 드라이브 전송 링크(DriveTransferLinkService) 발급·사용 — 사용 기록의 actor 는 링크 발급자다.
 */
export const AUDIT_ACTION_TYPES = [
  { value: 'CREATE', label: '생성' },
  { value: 'UPDATE', label: '수정' },
  { value: 'DELETE', label: '삭제' },
  { value: 'LOGIN', label: '로그인' },
  { value: 'LOGOUT', label: '로그아웃' },
  { value: 'IMPORT', label: '임포트' },
  { value: 'EXECUTE', label: '실행' },
  { value: 'DATA_EXPORT', label: '데이터 내보내기' },
  { value: 'STATUS_CHANGE', label: '상태 변경' },
  { value: 'USER_TOKEN_ISSUED', label: 'PAT 발급' },
  { value: 'USER_TOKEN_REVOKED', label: 'PAT 회수' },
  { value: 'AGENT_KEY_ISSUED', label: 'AGENT 키 발급' },
  { value: 'AGENT_KEY_REVOKED', label: 'AGENT 키 회수' },
  { value: 'AGENT_OAUTH_TOKEN_REGISTERED', label: 'AGENT 프로바이더 자격증명 등록' },
  { value: 'AGENT_OAUTH_TOKEN_REVOKED', label: 'AGENT 프로바이더 자격증명 회수' },
  { value: 'PLATFORM_LOGIN', label: '운영자 로그인' },
  { value: 'PLATFORM_LOGOUT', label: '운영자 로그아웃' },
  { value: 'AGENT_CREATED', label: 'AGENT 유저 생성' },
  { value: 'AGENT_DELETED', label: 'AGENT 유저 삭제' },
  { value: 'AGENT_RENAMED', label: 'AGENT 유저 변경' },
  { value: 'MEMBER_CREATED', label: '구성원 계정 생성' },
  { value: 'FILE_UPLOAD', label: '파일 업로드' },
  { value: 'FILE_VERSION_CREATED', label: '파일 새 버전 생성' },
  { value: 'FILE_RENAME', label: '파일 이름 변경' },
  { value: 'FILE_DELETE', label: '파일 삭제' },
  { value: 'FILE_ROLLBACK', label: '파일 롤백' },
  { value: 'FILE_SHARE', label: '공유 링크 생성' },
  { value: 'SHARE_LINK_LOCKED', label: '공유 링크 잠금' },
  { value: 'TRANSFER_LINK_CREATE', label: '전송 링크 발급' },
  { value: 'TRANSFER_LINK_USE', label: '전송 링크 사용' },
];

/**
 * 리소스 유형 옵션 목록
 * - 백엔드 호출부(AuthService/PipelineExecutionService/DatasetService/DataImportService/DataExportService/ApiConnectionNotifier)에서
 *   실제 사용 중인 resource 값 전수: auth/system/api_connection/pipeline/dataset (data_import는 dataimport 도메인에서 dataset으로 기록).
 * - #109 회귀: auth/system/api_connection 매핑 누락으로 영문 raw 값 노출되던 문제 해소.
 * - #778 회귀: user_api_token/agent_api_key/ai_agent_credential/platform/drive 매핑 누락 보강.
 */
export const AUDIT_RESOURCES = [
  { value: 'auth', label: '인증' },
  { value: 'user', label: '사용자' },
  { value: 'role', label: '역할' },
  { value: 'dataset', label: '데이터셋' },
  { value: 'pipeline', label: '파이프라인' },
  { value: 'data_import', label: '데이터 임포트' },
  { value: 'api_connection', label: 'API 연결' },
  { value: 'system', label: '시스템' },
  { value: 'user_api_token', label: 'API 토큰' },
  { value: 'agent_api_key', label: 'AGENT API 키' },
  { value: 'ai_agent_credential', label: 'AGENT 자격증명' },
  { value: 'platform', label: '플랫폼' },
  { value: 'drive', label: '드라이브' },
];

/**
 * 액션 유형 enum → 한글 라벨 매핑 (#109)
 * - 테이블 컬럼/상세 다이얼로그가 영문 raw 값을 그대로 표시하던 문제 해소.
 * - 알 수 없는(미래 추가) enum은 raw 값을 fallback으로 노출 + 콘솔 경고.
 */
const ACTION_LABEL_MAP: Record<string, string> = Object.fromEntries(AUDIT_ACTION_TYPES.map((t) => [t.value, t.label]));

/** 리소스 enum → 한글 라벨 매핑 (#109) */
const RESOURCE_LABEL_MAP: Record<string, string> = Object.fromEntries(AUDIT_RESOURCES.map((r) => [r.value, r.label]));

/** 액션 enum 값을 한글 라벨로 변환. 매핑 없으면 raw 반환 + 경고. */
export function formatAuditAction(action: string | null | undefined): string {
  if (!action) return '-';
  const label = ACTION_LABEL_MAP[action];
  if (!label) {
    console.warn(`[AuditLog] Unknown actionType: ${action}`);
    return action;
  }
  return label;
}

/** 리소스 enum 값을 한글 라벨로 변환. 매핑 없으면 raw 반환 + 경고. */
export function formatAuditResource(resource: string | null | undefined): string {
  if (!resource) return '-';
  const label = RESOURCE_LABEL_MAP[resource];
  if (!label) {
    console.warn(`[AuditLog] Unknown resource: ${resource}`);
    return resource;
  }
  return label;
}

/**
 * FacetFilter onChange 값 → 단일값 상태. FacetFilter 의 toggle 은 멀티셀렉트(append)지만 백엔드(.eq())는 단일값만 받으므로
 * 마지막에 추가된 값만 남겨 "교체" 의미를 만든다(이전 값 자동 해제). 비었으면 ''(필터 없음).
 */
export function lastFacetValue(values: (string | number)[] | undefined): string {
  return values && values.length ? String(values[values.length - 1]) : '';
}
