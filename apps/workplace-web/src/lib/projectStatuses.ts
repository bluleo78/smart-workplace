// 프로젝트 상태(WP-808) 순수 로직 — 보드 컬럼·필터·상태 메뉴·인라인 편집기가 같은 기본 상태·권한·이름 검증을 쓰도록 모은다.
// 상태 목록은 서버가 늘 표시 순서(범주 → position → id)로 주므로 여기서는 다시 정렬하지 않는다.
import { arrayMove } from '@dnd-kit/sortable';

import { CATEGORY_COLOR } from '../components/issues/issueCategoryColor';
import type { IssueStatus } from '../types/issue';
import type { ColorToken } from '../types/label';
import type { ProjectType } from '../types/project';
import type { ProjectStatus } from '../types/projectStatus';
import { ISSUE_STATUS_LABEL, ISSUE_STATUSES } from './issueGrouping';
import { LABEL_COLORS } from './labelColors';
import { directionParticle } from './utils';

/** 이름 중복 문구 — 클라이언트 검증과 서버 409(동시 중복)를 입력기가 같은 문구로 보인다. */
export const STATUS_NAME_DUPLICATED = '이미 존재하는 상태 이름입니다';

/**
 * 범주 코드 이름 거절 문구 — 서버 ProjectStatusService 와 같은 문구. 이력은 예전 행의 범주 코드와 새 행의 상태 이름을 한 칸에 담아,
 * 「DONE」이라는 이름이 「완료」 범주 라벨로 잘못 보이므로 범주 코드는 상태 이름으로 쓰지 못한다.
 */
export const STATUS_NAME_IS_CATEGORY = '범주 코드(TODO·IN_PROGRESS·DONE·CANCELED)는 상태 이름으로 쓸 수 없습니다';

/** 상태 이름 최대 길이 — 서버 ProjectStatusService.NAME_MAX 와 같다(코드 포인트 기준). */
export const STATUS_NAME_MAX = 30;

/** 범주별 상태 목록 — 범주 4개를 모두 키로 두고(없으면 빈 배열) 각 범주 안은 받은(표시) 순서 그대로. */
export function statusesByCategory(list: readonly ProjectStatus[]): Record<IssueStatus, ProjectStatus[]> {
  const by = Object.fromEntries(ISSUE_STATUSES.map((c) => [c, [] as ProjectStatus[]])) as Record<
    IssueStatus,
    ProjectStatus[]
  >;
  for (const s of list) by[s.category].push(s);
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
 * 컬럼과 같은 목록 순서로 세므로 띠가 컬럼 순서와 어긋나지 않는다.
 */
export function categorySpans(list: readonly ProjectStatus[]): CategorySpan[] {
  const by = statusesByCategory(list);
  return ISSUE_STATUSES.filter((c) => by[c].length > 0).map((c) => ({
    category: c,
    label: ISSUE_STATUS_LABEL[c],
    count: by[c].length,
  }));
}

/**
 * 범주의 기본 상태 — 그 범주에서 가장 앞(position 최소) 상태. 서버 project_status_default_id 와 같은 규칙. 없으면 undefined.
 * 목록이 표시 순서라 범주에서 처음 만나는 상태가 기본 상태다.
 */
export function defaultStatusOf(list: readonly ProjectStatus[], category: IssueStatus): ProjectStatus | undefined {
  return list.find((s) => s.category === category);
}

/** 선택지 값(statusId 문자열·숫자)으로 상태를 찾는다 — 셀렉트·시트·메뉴가 값을 문자열로 돌려준다. 없으면 undefined. */
export function findStatus(list: readonly ProjectStatus[], value: string | number): ProjectStatus | undefined {
  return list.find((s) => String(s.id) === String(value));
}

/**
 * 완료 전환 확인이 필요한가(#827) — 완료 범주로 처음 들어가고(같은 완료 범주 안 이동은 이미 완료라 묻지 않는다)
 * 미완료 선행 이슈가 있을 때. 데스크톱 상태 셀렉트와 모바일 상태 칩이 같은 규칙을 쓴다.
 */
export function needsDoneConfirm(
  next: ProjectStatus,
  currentCategory: IssueStatus | undefined,
  blockerCount: number,
): boolean {
  return next.category === 'DONE' && currentCategory !== 'DONE' && blockerCount > 0;
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
 * 앞뒤 공백을 빼고 본다: 비었으면 입력 요청, 30자 초과면 길이 오류, 범주 코드(대소문자 무시)면 거절,
 * 같은 프로젝트에 대소문자만 다른 이름까지 중복으로 본다.
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
  if ((ISSUE_STATUSES as readonly string[]).includes(trimmed.toUpperCase())) return STATUS_NAME_IS_CATEGORY;
  const key = trimmed.toLowerCase();
  if (list.some((s) => s.id !== excludeId && s.name.trim().toLowerCase() === key)) return STATUS_NAME_DUPLICATED;
  return null;
}

/** 프로젝트당 상태 상한(WP-811) — 서버 ProjectStatusService 와 같다. 「+ 추가」를 미리 막아 409 를 만나지 않게. */
export const STATUS_LIMIT = 20;

/** 상한에 닿아 「+ 추가」가 비활성일 때의 툴팁. */
export const STATUS_LIMIT_TOOLTIP = `상태는 프로젝트당 ${STATUS_LIMIT}개까지예요`;

/**
 * 범주 기본 색 토큰(WP-809) — 서버 백필·새 상태 기본 색과 같다. 이 색인 상태는 지금까지처럼 범주 시맨틱 아이콘 색을 쓴다
 * (기본 4상태가 색 백필 뒤에도 조용히 바뀌지 않게).
 */
export const CATEGORY_DEFAULT_COLOR: Record<IssueStatus, ColorToken> = {
  TODO: 'GRAY',
  IN_PROGRESS: 'BLUE',
  DONE: 'GREEN',
  CANCELED: 'GRAY',
};

/**
 * 상태를 더 만들 수 없는 이유 — 상한(20)에 닿았으면 상한 문구, 더 만들 수 있으면 undefined.
 * 「+ 추가」류 진입점(설정·보드 띠·컬럼 메뉴·모바일 시트)이 비활성 판정과 보일 이유를 한 값으로 쓴다.
 */
export function statusAddBlockedReason(list: readonly ProjectStatus[]): string | undefined {
  return list.length < STATUS_LIMIT ? undefined : STATUS_LIMIT_TOOLTIP;
}

/** 범주의 기본 상태(범주 안 첫 상태)인가 — 설정 행의 「기본」 표시. */
export function isDefaultStatus(list: readonly ProjectStatus[], s: ProjectStatus): boolean {
  return defaultStatusOf(list, s.category)?.id === s.id;
}

/** 그 범주에 이 상태 하나만 남았는가 — 서버가 409 로 거절하므로 삭제를 미리 막는다. */
export function isLastInCategory(list: readonly ProjectStatus[], s: ProjectStatus): boolean {
  return !list.some((x) => x.category === s.category && x.id !== s.id);
}

/**
 * 같은 범주 안에서 한 칸 위(-1)·아래(1)로 옮긴 그 범주의 새 id 순서 — 순서 변경 API(statusIds = 범주 전체)에 그대로 보낸다.
 * 범주 경계(첫 상태 위로·마지막 아래로)이거나 모르는 id 면 null — 메뉴 「위로/아래로 이동」 비활성 판정을 겸한다.
 */
export function moveWithinCategory(list: readonly ProjectStatus[], id: number, dir: -1 | 1): number[] | null {
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  const ids = categoryIds(list, s.category);
  const to = ids.indexOf(id) + dir;
  if (to < 0 || to >= ids.length) return null;
  return moveId(ids, id, ids[to]);
}

/** 끌어 놓기(dnd-kit) 결과 — 그 범주 안에서 activeId 를 overId 자리로 옮긴 새 id 순서. 범주 밖 id 면 원래 순서 그대로. */
export function reorderWithinCategory(
  list: readonly ProjectStatus[],
  category: IssueStatus,
  activeId: number,
  overId: number,
): number[] {
  return moveId(categoryIds(list, category), activeId, overId);
}

/** 범주 안 상태 id 들(표시 순서) — 순서 변경 두 경로(메뉴 한 칸 이동·끌어 놓기)가 같은 목록에서 출발한다. */
function categoryIds(list: readonly ProjectStatus[], category: IssueStatus): number[] {
  return statusesByCategory(list)[category].map((x) => x.id);
}

/** ids 안에서 activeId 를 overId 자리로 옮긴 새 배열 — 둘 중 하나라도 없으면 원래 순서 그대로. */
function moveId(ids: number[], activeId: number, overId: number): number[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return ids;
  return arrayMove(ids, from, to);
}

/**
 * 삭제 창의 기본 「옮길 상태」 — 같은 범주의 기본 상태(범주가 그대로라 조용히 옮겨진다).
 * 지우는 것이 기본이면 같은 범주 다음 상태. 범주에 하나뿐이면 undefined(마지막 상태는 지울 수 없다).
 */
export function defaultMoveTarget(list: readonly ProjectStatus[], deleting: ProjectStatus): ProjectStatus | undefined {
  return list.find((s) => s.category === deleting.category && s.id !== deleting.id);
}

/** 삭제 창의 「옮길 상태」 선택지 — 지우는 상태를 빼고 같은 범주(위)·다른 범주(아래)로 나눈다. 각 묶음은 표시 순서 그대로. */
export function moveTargetGroups(
  list: readonly ProjectStatus[],
  deleting: ProjectStatus,
): { same: ProjectStatus[]; other: ProjectStatus[] } {
  const rest = list.filter((s) => s.id !== deleting.id);
  return {
    same: rest.filter((s) => s.category === deleting.category),
    other: rest.filter((s) => s.category !== deleting.category),
  };
}

const isClosedCategory = (c: IssueStatus) => c === 'DONE' || c === 'CANCELED';

/**
 * 다른 범주로 옮기며 지울 때의 경고 — 같은 범주면 null(조용히 옮겨진다).
 * 「종료 시각이 기록돼요」는 열린 범주 → 완료·취소일 때만 넣는다 — 스펙의 「(완료·취소면)」은 문구가 아니라 이 조건이다. 해당 없을 때 거짓 안내를 하지 않게.
 */
export function deletionWarning(from: IssueStatus, to: IssueStatus, n: number): string | null {
  if (from === to) return null;
  const a = ISSUE_STATUS_LABEL[from];
  // 범주 라벨 뒤 조사 「(으)로」는 받침에 맞춰 붙인다(「완료로」·「진행 중으로」).
  const toLabel = ISSUE_STATUS_LABEL[to];
  const b = `${toLabel}${directionParticle(toLabel)}`;
  const processed =
    isClosedCategory(to) && !isClosedCategory(from)
      ? `이슈 ${n}개가 ${b} 처리되고 종료 시각이 기록돼요.`
      : `이슈 ${n}개가 ${b} 처리돼요.`;
  return `범주가 ${a} → ${b} 바뀌어요. ${processed} 담당자에게 알림은 가지 않아요.`;
}

/**
 * 상태 아이콘 색 클래스 — 모양은 범주, 색은 상태 색(WP-809 A안).
 * 색이 없거나(구 서버 응답) 범주 기본 색이거나 모르는 토큰이면 범주 시맨틱 클래스(CATEGORY_COLOR) — 기존 화면이 바뀌지 않는다.
 * 다른 색이면 배경 없는 글자색(LABEL_COLORS.fg, 다크 *-300)으로 라이트·다크 대비를 지킨다.
 */
export function statusIconClass(category: IssueStatus, color?: string | null): string {
  const token = color as ColorToken | null | undefined;
  if (!token || token === CATEGORY_DEFAULT_COLOR[category] || !LABEL_COLORS[token]) return CATEGORY_COLOR[category].icon;
  return LABEL_COLORS[token].fg;
}
