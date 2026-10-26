// 프로젝트 버전(WP-888) 타입 — 백엔드 VersionResponse·VersionSummary·요청 DTO 와 1:1.
// 버전은 출시 단위로 이슈를 모은다(수정 버전 = 이 버전에 나가는 것, 영향 버전 = 이 버전에서 난 결함).

/** 버전 상태 — 보관 > 출시됨 > 미출시 순으로 서버가 정한다. */
export type VersionStatus = 'UNRELEASED' | 'RELEASED' | 'ARCHIVED';

/** 진행 — 수정 버전 이슈를 상태 범주로 센 값(취소는 완료로 센다). 전체 = 합. */
export interface VersionProgress {
  done: number;
  inProgress: number;
  todo: number;
}

/** 프로젝트 버전 한 건 — 목록·상세가 쓴다. 목록 순서(미출시 → 출시됨 → 보관)는 서버가 정한다. */
export interface VersionResponse {
  id: number;
  name: string;
  description: string | null;
  // yyyy-MM-dd — 없으면 null.
  startDate: string | null;
  releaseDate: string | null;
  status: VersionStatus;
  // 출시 처리한 시각(ISO) — 미출시면 null.
  releasedAt: string | null;
  progress: VersionProgress;
  // 영향 버전으로 붙은 이슈 수(취소 포함).
  affectsCount: number;
}

/** 이슈에 붙은 버전 요약 — IssueResponse.fixVersions·affectsVersions 에 임베드. */
export interface VersionSummary {
  id: number;
  name: string;
  status: VersionStatus;
}

/** 이슈 버전 교체 본문 — 빠진 키는 그 종류를 건드리지 않고, 빈 배열이면 그 종류를 모두 뗀다. */
export interface ReplaceIssueVersionsRequest {
  fixVersionIds?: number[];
  affectsVersionIds?: number[];
}

/** 이슈 버전 교체 응답 — 저장된 두 종류(목록 순서). */
export interface IssueVersionsResponse {
  fixVersions: VersionSummary[];
  affectsVersions: VersionSummary[];
}

/** 삭제 확인창·출시 대화상자가 쓰는 붙은 이슈 수. unresolvedFix = 수정 버전으로 붙은 끝나지 않은 이슈. */
export interface VersionIssueCount {
  fix: number;
  affects: number;
  unresolvedFix: number;
}

/** 버전 추가 본문 — 이름 1~40자, 설명 0~500자, 날짜는 yyyy-MM-dd(시작일 <= 출시일). */
export interface CreateVersionRequest {
  name: string;
  description?: string | null;
  startDate?: string | null;
  releaseDate?: string | null;
}

/** 부분 수정 본문 — 보낸 필드만 바뀐다. 값을 지우려면 clear* 플래그를 쓴다(값과 같이 보낼 수 없다). */
export interface UpdateVersionRequest {
  name?: string;
  description?: string;
  clearDescription?: boolean;
  startDate?: string;
  clearStartDate?: boolean;
  releaseDate?: string;
  clearReleaseDate?: boolean;
  archived?: boolean;
}

/** 출시 본문 — 출시일을 안 보내면 기존 출시 예정일, 그것도 없으면 오늘. moveUnresolvedTo 가 있으면 끝나지 않은 수정 버전 이슈를 그 버전으로 옮긴다. */
export interface ReleaseVersionRequest {
  releaseDate?: string;
  moveUnresolvedTo?: number;
}

/** 이름·설명 길이 상한 — 서버 검증과 같은 값. */
export const VERSION_NAME_MAX = 40;
export const VERSION_DESCRIPTION_MAX = 500;

/** 상태 배지·접근성 라벨. */
export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  UNRELEASED: '미출시',
  RELEASED: '출시됨',
  ARCHIVED: '보관됨',
};
