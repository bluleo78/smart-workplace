// 버전 화면 순수 로직(WP-888) — 기한 판정·남은 일수 문구·이슈 유형별 묶음·다음 미출시 버전·다른 버전 표기.
// 날짜는 모두 yyyy-MM-dd 키로 비교한다(시간대 변환 없음). today 는 호출부가 kstDateKey(new Date()) 로 넘긴다.

import type { IssueResponse } from '../types/issue';
import type { IssueTypeSummary } from '../types/issueType';
import type { UpdateVersionRequest, VersionResponse } from '../types/version';
import { formatDateKey, parseDateKey, parseValidDateKey } from './formatters';
import { daysUntilLocalDate } from './myTasks';

export type VersionDueState = 'none' | 'upcoming' | 'overdue';

/** 기한 상태 — 미출시이고 출시일이 있으면, 오늘 전이면 overdue(붉은 「지남」), 아니면 upcoming. 그 밖(출시됨·보관됨·날짜 없음)은 none. */
export function versionDueState(
  v: Pick<VersionResponse, 'status' | 'releaseDate'>,
  today: string,
): VersionDueState {
  if (v.status !== 'UNRELEASED' || !v.releaseDate) return 'none';
  // yyyy-MM-dd 는 문자열 비교가 날짜 순서와 같다.
  return v.releaseDate < today ? 'overdue' : 'upcoming';
}

/** 「N일 남음」/「N일 지남」 — 미출시이고 출시일이 있을 때만. 오늘이면 「오늘 출시 예정」. */
export function daysLeftLabel(
  v: Pick<VersionResponse, 'status' | 'releaseDate'>,
  today: string,
): string | null {
  if (v.status !== 'UNRELEASED' || !v.releaseDate) return null;
  // 로컬 자정끼리의 일수 차 — 공용 daysUntilLocalDate 가 반올림으로 일광절약 전환일의 23·25시간을 흡수한다.
  const diff = daysUntilLocalDate(v.releaseDate, parseDateKey(today));
  if (diff === 0) return '오늘 출시 예정';
  return diff > 0 ? `${diff}일 남음` : `${-diff}일 지남`;
}

export interface IssueTypeGroup {
  /** 묶음의 유형 — 유형이 없거나 프로젝트 유형 목록에 없는 이슈는 null(맨 끝). */
  type: IssueTypeSummary | null;
  issues: IssueResponse[];
}

/** 이슈를 유형별로 묶는다 — 프로젝트 유형 순서(types 의 순서)를 따르고 빈 묶음은 뺀다. 이슈 안의 순서는 입력 순서 그대로. */
export function groupIssuesByType(
  issues: readonly IssueResponse[],
  types: readonly IssueTypeSummary[],
): IssueTypeGroup[] {
  const byType = new Map<number, IssueResponse[]>();
  const rest: IssueResponse[] = [];
  const known = new Set(types.map((t) => t.id));
  for (const issue of issues) {
    const id = issue.type?.id;
    if (id == null || !known.has(id)) {
      rest.push(issue);
      continue;
    }
    const list = byType.get(id);
    if (list) list.push(issue);
    else byType.set(id, [issue]);
  }
  const groups: IssueTypeGroup[] = types
    .filter((t) => byType.has(t.id))
    .map((t) => ({ type: t, issues: byType.get(t.id) as IssueResponse[] }));
  if (rest.length > 0) groups.push({ type: null, issues: rest });
  return groups;
}

/** 목록 순서상 현재 버전 뒤의 첫 미출시 버전 — 출시 대화상자의 「다음 버전으로 옮기기」 기본 대상. 보관·출시된 것은 건너뛰고, 없으면 null. */
export function nextUnreleased(list: readonly VersionResponse[], currentId: number): VersionResponse | null {
  const idx = list.findIndex((v) => v.id === currentId);
  if (idx < 0) return null;
  return list.slice(idx + 1).find((v) => v.status === 'UNRELEASED') ?? null;
}

/** 이 이슈가 현재 버전 말고 수정 버전으로 붙은 다른 버전 이름 — 상세 행의 「{이름} 에도 포함」. */
export function alsoInOtherVersions(issue: IssueResponse, currentId: number): string[] {
  return (issue.fixVersions ?? []).filter((fv) => fv.id !== currentId).map((fv) => fv.name);
}

/** 날짜 칸 표시 — yyyy-MM-dd 키를 그대로(해석 못 하면 null). 포매터는 formatters 의 키 함수만 쓴다. */
export function versionDateText(key: string | null | undefined): string | null {
  const d = parseValidDateKey(key);
  return d ? formatDateKey(d) : null;
}

/**
 * 이슈 수 조회가 이번 열림에서 새로 읽혀 믿을 만한가 — 캐시에 남은 옛 값(이전에 열었을 때의 수)이나 다시 읽는 중·실패 상태에서는
 * false 여서, 되돌릴 수 없는 출시·삭제가 낡은 수로 진행되지 않는다.
 */
export function isCountFresh(q: { data?: unknown; isFetchedAfterMount: boolean; isFetching: boolean; isError: boolean }): boolean {
  return q.data != null && q.isFetchedAfterMount && !q.isFetching && !q.isError;
}

/** 만들기·편집 대화상자의 입력값 — 날짜는 비면 ''. */
export interface VersionDraft {
  name: string;
  description: string;
  startDate: string;
  releaseDate: string;
}

/** 시작일이 출시일보다 늦은가(둘 다 있을 때) — 서버가 400 으로 막기 전에 대화상자가 미리 알린다. */
export function isVersionDateRangeInvalid(startDate: string, releaseDate: string): boolean {
  return !!startDate && !!releaseDate && startDate > releaseDate;
}

/**
 * 편집 저장 본문 — 바뀐 필드만 싣는다. 설명·날짜를 비우면 값 대신 지우기 플래그를 보낸다(서버는 값과 플래그를 같이 못 받는다).
 * 바뀐 게 없으면 빈 객체 — 호출부가 요청 없이 닫는다.
 */
export function versionPatch(target: VersionResponse, draft: VersionDraft): UpdateVersionRequest {
  const body: UpdateVersionRequest = {};
  const name = draft.name.trim();
  if (name !== target.name) body.name = name;
  const description = draft.description.trim();
  if (description !== (target.description ?? '')) {
    if (description) body.description = description;
    else body.clearDescription = true;
  }
  if (draft.startDate !== (target.startDate ?? '')) {
    if (draft.startDate) body.startDate = draft.startDate;
    else body.clearStartDate = true;
  }
  if (draft.releaseDate !== (target.releaseDate ?? '')) {
    if (draft.releaseDate) body.releaseDate = draft.releaseDate;
    else body.clearReleaseDate = true;
  }
  return body;
}

/** 행 메뉴에 보일 동작 — 편집·출시/출시 취소·보관/복원, 삭제는 보관한 버전에만(서버도 막는다). 관리 권한이 없으면 없음. */
export type VersionRowAction = 'edit' | 'release' | 'unrelease' | 'archive' | 'restore' | 'delete';

export function versionRowActions(v: Pick<VersionResponse, 'status'>, canManage: boolean): VersionRowAction[] {
  if (!canManage) return [];
  if (v.status === 'ARCHIVED') return ['edit', 'restore', 'delete'];
  return ['edit', v.status === 'RELEASED' ? 'unrelease' : 'release', 'archive'];
}

/**
 * 이슈 목록에서 열기 URL — 목록 필터 쿼리 키는 구성요소(component)와 같은 방식(id)이다. kind 는 fixVersion | affectsVersion.
 * 목록은 종료 이슈까지 보이지만 기본 범위(에픽·하위 작업 제외)는 그대로라, 버전 상세보다 적게 보일 수 있다.
 */
export function versionIssuesUrl(projectKey: string, kind: 'fixVersion' | 'affectsVersion', id: number): string {
  return `/projects/${projectKey}?view=list&${kind}=${id}`;
}
