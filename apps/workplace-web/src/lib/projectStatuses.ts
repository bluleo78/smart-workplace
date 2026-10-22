// 프로젝트 상태(WP-808) 순수 로직 — 보드 컬럼·필터·상태 메뉴·인라인 편집기가 같은 정렬·기본 상태·권한·이름 검증을 쓰도록 모은다.
import type { IssueStatus } from '../types/issue';
import type { ProjectType } from '../types/project';
import type { ProjectStatus } from '../types/projectStatus';
import { ISSUE_STATUS_LABEL, ISSUE_STATUSES } from './issueGrouping';

/** 상태 이름 최대 길이 — 서버 ProjectStatusService.NAME_MAX 와 같다(코드 포인트 기준). */
export const STATUS_NAME_MAX = 30;

/**
 * 표시 순서로 정렬한 복사본 — 범주 순서(할 일 → 진행 중 → 완료 → 취소) → position → id.
 * 서버 목록 순서와 같은 규칙이며, 쿼리 캐시 배열을 그대로 넘겨도 원본을 바꾸지 않는다.
 */
export function sortStatuses(list: readonly ProjectStatus[]): ProjectStatus[] {
  const rank = (c: IssueStatus) => ISSUE_STATUSES.indexOf(c);
  return [...list].sort((a, b) => rank(a.category) - rank(b.category) || a.position - b.position || a.id - b.id);
}

/** 범주별 상태 목록 — 범주 4개를 모두 키로 두고(없으면 빈 배열) 각 범주 안은 표시 순서. */
export function statusesByCategory(list: readonly ProjectStatus[]): Record<IssueStatus, ProjectStatus[]> {
  const by = Object.fromEntries(ISSUE_STATUSES.map((c) => [c, [] as ProjectStatus[]])) as Record<
    IssueStatus,
    ProjectStatus[]
  >;
  for (const s of sortStatuses(list)) by[s.category].push(s);
  return by;
}

/** 보드 범주 띠 한 칸 — 범주와 고정 라벨, 그 범주에 속한 컬럼 수(띠가 걸칠 폭). */
export interface CategorySpan {
  category: IssueStatus;
  label: string;
  count: number;
}

/**
 * 보드 범주 띠 구간 — 범주 순서대로, 컬럼(상태)이 있는 범주만. 라벨은 범주 고정 라벨(상태 이름이 아님)이다.
 * 컬럼과 같은 정렬(sortStatuses)로 세므로 띠가 컬럼 순서와 어긋나지 않는다.
 */
export function categorySpans(list: readonly ProjectStatus[]): CategorySpan[] {
  const by = statusesByCategory(list);
  return ISSUE_STATUSES.filter((c) => by[c].length > 0).map((c) => ({
    category: c,
    label: ISSUE_STATUS_LABEL[c],
    count: by[c].length,
  }));
}

/** 범주의 기본 상태 — 그 범주에서 가장 앞(position 최소) 상태. 서버 project_status_default_id 와 같은 규칙. 없으면 undefined. */
export function defaultStatusOf(list: readonly ProjectStatus[], category: IssueStatus): ProjectStatus | undefined {
  return statusesByCategory(list)[category][0];
}

/**
 * 상태를 추가·이름 변경할 수 있는가 — 프로젝트 OWNER 이고 개인 프로젝트가 아닐 때. 서버 규칙과 같게 ADMIN 우회는 없다.
 * 프로젝트 유형을 아직 모르면(undefined) OWNER 여부만 보고, 개인 프로젝트는 서버가 최종 거절한다.
 */
export function canEditStatuses(isOwner: boolean, projectType?: ProjectType): boolean {
  return isOwner && projectType !== 'PERSONAL';
}

/**
 * 상태 이름 검증 — 오류 문구(인라인 편집기가 입력 아래 보인다) 또는 null.
 * 앞뒤 공백을 빼고 본다: 비었으면 입력 요청, 30자 초과면 길이 오류, 같은 프로젝트에 대소문자만 다른 이름까지 중복으로 본다.
 * excludeId — 이름을 바꾸는 상태 자신은 중복 비교에서 뺀다(그대로 저장해도 오류가 나지 않게).
 */
export function validateStatusName(
  name: string,
  list: readonly ProjectStatus[],
  excludeId?: number,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '상태 이름을 입력해 주세요';
  // 서버가 코드 포인트로 세므로 이모지 등 서로게이트 쌍을 한 글자로 센다.
  if ([...trimmed].length > STATUS_NAME_MAX) return `상태 이름은 ${STATUS_NAME_MAX}자 이하로 입력해 주세요`;
  const key = trimmed.toLowerCase();
  if (list.some((s) => s.id !== excludeId && s.name.trim().toLowerCase() === key)) return '이미 존재하는 상태 이름입니다';
  return null;
}
