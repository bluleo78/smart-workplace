// 프로젝트 상태(WP-808·WP-809) 쿼리/뮤테이션 훅 — 목록 + OWNER 전용 추가·수정(이름·색)·순서 변경·삭제.
// 쿼리 키는 projectStatusesKey 한 곳에서 만든다 — SSE 'project-status' 무효화 규칙(lib/resourceInvalidation)도 이것을 쓴다.

import { type InfiniteData, type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';

import { getIssueGroupCounts } from '../../api/issues';
import {
  createProjectStatus,
  type CreateProjectStatusBody,
  deleteProjectStatus,
  listProjectStatuses,
  reorderProjectStatuses,
  type ReorderProjectStatusesBody,
  updateProjectStatus,
  type UpdateProjectStatusBody,
} from '../../api/projectStatuses';
import { extractApiErrorCode } from '../../lib/api-error';
import type { IssueDetailResponse, IssueFilters, IssueResponse, IssueSearchResponse, IssueStatus } from '../../types/issue';
import type { ProjectStatus } from '../../types/projectStatus';

/** 프로젝트 상태 목록 쿼리 키 — 조회·무효화·캐시 직접 갱신이 모두 이 키를 쓴다. */
export function projectStatusesKey(projectKey: string | undefined) {
  return ['projectStatuses', projectKey] as const;
}

// 프로젝트의 상태 목록 — projectKey 가 아직 없으면(라우트 로딩 중) 조회하지 않는다.
// 목록이 도착·갱신되면 이미 캐시된 이슈 검색 페이지에 모르는 상태가 있는지 다시 본다 — 이슈 검색이 목록보다 먼저 와
// 그때는 판정을 건너뛰었더라도(refreshStatusesOnUnknown 참고) 목록이 온 뒤 한 번 더 물을 수 있게.
export function useProjectStatuses(projectKey?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: projectStatusesKey(projectKey),
    queryFn: () => listProjectStatuses(projectKey!),
    enabled: !!projectKey,
  });
  const { data } = query;
  useEffect(() => {
    if (!projectKey || !data) return;
    // 이 목록으로는 캐시 검사를 한 번만 — 상태 목록을 쓰는 소비자가 여럿이어도 검색 캐시를 소비자 수만큼 훑지 않는다.
    const check = statusCheckFor(qc, data);
    if (check.scanned) return;
    check.scanned = true;
    const pages = qc.getQueriesData<InfiniteData<IssueSearchResponse>>({ queryKey: ['issues', 'search', projectKey] });
    const issues = pages.flatMap(([, d]) => d?.pages?.flatMap((p) => p.items ?? []) ?? []);
    refreshStatusesOnUnknown(qc, projectKey, issues);
  }, [qc, projectKey, data]);
  return query;
}

// 로딩 중·키 없음일 때 돌려줄 고정 빈 배열 — 매 렌더 새 배열을 만들면 이것을 deps 로 쓰는 memo 가 매번 깨진다.
export const NO_STATUSES: ProjectStatus[] = [];

/**
 * 프로젝트 상태 목록(서버 표시 순서: 범주 → position) — 상태 선택·행 메뉴·모바일 시트·목록 그룹이 같은 순서를 쓴다.
 * 서버가 이미 정렬해 주므로 다시 정렬하지 않는다. 로딩 중이면 빈 배열이다 —
 * 프로젝트는 늘 기본 4상태를 가지므로 빈 배열 = 아직 모름(호출부가 숨김·범주 폴백을 정한다).
 */
export function useProjectStatusList(projectKey?: string): ProjectStatus[] {
  return useProjectStatuses(projectKey).data ?? NO_STATUSES;
}

/**
 * 이슈들이 가리키는 statusId 중 상태 목록에 없는 것(중복 없이, 처음 나온 순서).
 * 다른 사용자가 방금 만든 상태로 옮긴 이슈가 project-status 이벤트보다 먼저(또는 그 이벤트 없이) 도착하면 생긴다.
 */
export function unknownStatusIds(issues: readonly { statusId?: number | null }[], statuses: readonly ProjectStatus[]): number[] {
  const known = new Set(statuses.map((s) => s.id));
  const out = new Set<number>();
  for (const it of issues) {
    if (typeof it.statusId === 'number' && !known.has(it.statusId)) out.add(it.statusId);
  }
  return [...out];
}

// 상태 목록(배열 참조)별 판정 기록 — asked: 이미 다시 받게 한 상태 id, scanned: 이 목록으로 캐시된 검색 페이지를 훑었는가.
// 다시 받은 내용이 같으면 TanStack 구조 공유로 같은 참조가 남아 같은 id 를 또 묻지 않고(무한 재조회 방지), 내용이 바뀌어 새 배열이 오면
// 빈 기록으로 다시 물을 수 있다 — 앱 세션 내내 쌓이지 않는다. QueryClient 마다 따로 둔다(같은 배열을 다른 클라이언트에 넣어도 섞이지 않게).
interface StatusCheck {
  asked: Set<number>;
  scanned: boolean;
}
const statusChecks = new WeakMap<QueryClient, WeakMap<readonly ProjectStatus[], StatusCheck>>();

function statusCheckFor(client: QueryClient, list: readonly ProjectStatus[]): StatusCheck {
  let byList = statusChecks.get(client);
  if (!byList) statusChecks.set(client, (byList = new WeakMap()));
  let check = byList.get(list);
  if (!check) byList.set(list, (check = { asked: new Set(), scanned: false }));
  return check;
}

/**
 * 이슈 검색 응답에 상태 목록에 없는 statusId 가 있으면 프로젝트 상태 목록을 한 번 다시 받는다(WP-808).
 * 왜: 그 상태 컬럼·버킷이 없어 보드에선 카드가 사라지고 목록에선 이름만 있는 버킷이 덧붙는다. 이슈 이벤트마다 상태 목록을 다시 받는 대신
 *     모르는 상태를 실제로 만났을 때만 받는다. 데이터 계층(이슈 검색 queryFn)과 상태 목록 도착(useProjectStatuses)에서 부른다.
 * - 상태 목록이 캐시에 없으면 건너뛴다 — 목록이 도착하면 useProjectStatuses 가 캐시된 검색 페이지로 다시 부른다.
 * - 같은 목록에선 같은 id 를 한 번만 — 다시 받아도 없으면(지워진 상태 등) 목록 내용이 바뀌기 전까지 반복 재조회하지 않는다.
 */
export function refreshStatusesOnUnknown(
  client: QueryClient,
  projectKey: string,
  issues: readonly { statusId?: number | null }[],
) {
  const statuses = client.getQueryData<ProjectStatus[]>(projectStatusesKey(projectKey));
  if (!statuses) return;
  const { asked } = statusCheckFor(client, statuses);
  const fresh = unknownStatusIds(issues, statuses).filter((id) => !asked.has(id));
  if (fresh.length === 0) return;
  fresh.forEach((id) => asked.add(id));
  void client.invalidateQueries({ queryKey: projectStatusesKey(projectKey) });
}

/**
 * 이슈 쓰기에 고른 상태가 없어졌을 때 서버가 싣는 오류 코드(ErrorResponse.errors.code — WP-936).
 * STATUS_DELETED(409): 서버 확인 뒤 삭제가 커밋된 경합. STATUS_NOT_FOUND(400): 요청 전에 이미 삭제돼 웹 목록이 낡은 경우.
 */
const STATUS_GONE_CODES = new Set(['STATUS_DELETED', 'STATUS_NOT_FOUND']);

/** 고른 상태가 없어져 거절된 오류인가(409 STATUS_DELETED·400 STATUS_NOT_FOUND) — 생성 폼이 토스트 문구를 바꾸는 데도 쓴다. */
export function isStatusGoneError(error: unknown): boolean {
  const code = extractApiErrorCode(error);
  return code != null && STATUS_GONE_CODES.has(code);
}

/**
 * 이슈 생성·수정·상태 변경이 「고른 상태가 없어짐」(409 STATUS_DELETED·400 STATUS_NOT_FOUND)으로 거절됐으면 상태 목록을 다시 받는다(WP-936).
 * 왜: 서버 안내가 「다른 상태를 골라 주세요」인데 고르기(보드 컬럼·상태 팝오버·생성 폼)가 지워진 상태를 계속 보여 주면 같은 거절을 되풀이한다.
 * 같은 409 인 버전 충돌(#611)과는 코드로 가른다 — 그래서 이 오류였는지 돌려준다(호출부가 버전 충돌 처리를 건너뛰게).
 * 실패 안내 토스트는 호출부가 서버 문구 그대로 띄운다.
 */
export function refreshStatusesIfGone(client: QueryClient, projectKey: string, error: unknown): boolean {
  if (!isStatusGoneError(error)) return false;
  void client.invalidateQueries({ queryKey: projectStatusesKey(projectKey) });
  return true;
}

/**
 * 상태 이름·색이 바뀌면 그 상태를 쓰는 이슈의 statusName·statusColor 를 캐시에서 제자리로 고친다 — 검색(보드·목록) 캐시와 이슈 상세 요약.
 * 이슈 검색 전체를 다시 받지 않는다(이름·색 말고는 바뀐 것이 없다). 그 상태의 이슈가 없는 캐시는 그대로 둔다.
 * 그 밖에 statusName 을 싣는 교차 프로젝트 이슈 목록(내 이슈·워치·AI 작업·홈 위젯)은 SSE project-status 규칙(lib/resourceInvalidation)이
 * 행위자 탭을 포함한 모든 화면에서 다시 받게 한다.
 */
function patchStatusInIssueCaches(
  qc: QueryClient,
  projectKey: string,
  statusId: number,
  patch: { name: string; color?: string | null },
) {
  const rename = (it: IssueResponse) =>
    it.statusId === statusId
      ? { ...it, statusName: patch.name, ...(patch.color !== undefined ? { statusColor: patch.color } : {}) }
      : it;
  qc.setQueriesData<InfiniteData<IssueSearchResponse>>({ queryKey: ['issues', 'search', projectKey] }, (old) => {
    if (!old?.pages?.some((p) => (p.items ?? []).some((it) => it.statusId === statusId))) return old;
    return { ...old, pages: old.pages.map((p) => ({ ...p, items: (p.items ?? []).map(rename) })) };
  });
  qc.setQueriesData<IssueDetailResponse>({ queryKey: ['issues', projectKey, 'detail'] }, (old) =>
    old?.summary?.statusId === statusId ? { ...old, summary: rename(old.summary) } : old,
  );
}

/**
 * 보드 상태 편집 배선(OWNER) — 상태 목록과 이름 변경·「이 뒤에」 추가·범주 끝 추가를 한 묶음으로 준다.
 * 왜: 보드(데스크톱 컬럼 헤더·범주 띠·모바일 탭 시트)가 같은 mutateAsync 람다를 세 번 만들고 있었다.
 * 모두 실패하면 reject 한다 — 입력기가 받아 그 자리에 오류를 보인다. addAfter 는 만든 상태를 돌려준다(모바일이 새 탭을 고른다).
 */
export function useStatusEditing(projectKey: string) {
  const statuses = useProjectStatusList(projectKey);
  const create = useCreateProjectStatus(projectKey);
  const update = useUpdateProjectStatus(projectKey);
  // mutateAsync 는 렌더마다 같은 참조라 이것을 deps 로 둔다(useMutation 결과 객체는 매번 새로 만들어져 memo 를 깬다).
  const createAsync = create.mutateAsync;
  const updateAsync = update.mutateAsync;
  return useMemo(
    () => ({
      statuses,
      rename: async (id: number, name: string) => {
        await updateAsync({ id, body: { name } });
      },
      addAfter: (after: ProjectStatus, name: string) =>
        createAsync({ name, category: after.category, afterStatusId: after.id }),
      addAt: async (category: IssueStatus, name: string) => {
        await createAsync({ name, category });
      },
    }),
    [statuses, updateAsync, createAsync],
  );
}

// OWNER — 상태 추가. 실패 문구(중복·길이)는 인라인 편집기가 입력 아래 보이므로 토스트를 띄우지 않는다.
// 상태 목록만 다시 받는다 — 새 상태를 쓰는 이슈는 아직 없어 이슈 검색 캐시는 그대로다(새 컬럼은 새 쿼리 키라 따로 받는다).
// 재조회 promise 를 돌려준다 — onSuccess 가 돌려주면 mutateAsync 가 새 목록이 캐시에 들어온 뒤 끝나,
// 호출부가 새 상태를 바로 고를 수 있다(모바일 보드 새 탭 선택).
export function useCreateProjectStatus(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectStatusBody) => createProjectStatus(projectKey, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectStatusesKey(projectKey) }),
  });
}

// OWNER — 상태 이름·색 수정. 실패 문구는 호출부(인라인 편집기·편집 창)가 보인다.
// 응답으로 목록 캐시의 그 상태와 그 상태를 쓰는 이슈의 이름·색을 제자리로 바꾼다(범주·순서는 그대로라 안전) —
// 상태 목록을 다시 받지 않는다(다른 화면은 SSE project-status 무효화가 맞춘다).
export function useUpdateProjectStatus(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: UpdateProjectStatusBody }) => updateProjectStatus(projectKey, v.id, v.body),
    onSuccess: (saved) => {
      qc.setQueryData<ProjectStatus[]>(projectStatusesKey(projectKey), (list) =>
        list?.map((s) => (s.id === saved.id ? { ...s, name: saved.name, color: saved.color } : s)),
      );
      patchStatusInIssueCaches(qc, projectKey, saved.id, { name: saved.name, color: saved.color });
    },
  });
}

/**
 * 목록에서 한 범주의 상태를 statusIds 순서로 다시 놓는다 — 그 범주 칸(연속 구간)의 기존 position 값을 오름차순으로 다시 나눠 준다.
 * 다른 범주 위치는 그대로다. 목록이 표시 순서라 defaultStatusOf·보드 컬럼이 바로 새 순서를 본다.
 */
export function applyCategoryOrder(list: readonly ProjectStatus[], category: IssueStatus, statusIds: readonly number[]): ProjectStatus[] {
  const inCat = list.filter((s) => s.category === category);
  const byId = new Map(inCat.map((s) => [s.id, s]));
  const ordered = statusIds.map((id) => byId.get(id)).filter((s): s is ProjectStatus => !!s);
  if (ordered.length !== inCat.length) return [...list];
  const positions = inCat.map((s) => s.position).sort((a, b) => a - b);
  let k = 0;
  return list.map((s) => (s.category === category ? { ...ordered[k], position: positions[k++] } : s));
}

// OWNER — 같은 범주 안 순서 변경(낙관적). 끌어 놓은 즉시 목록 캐시를 새 순서로 두고, 실패하면 되돌리며 토스트로 알린다.
// 끝나면(성공·실패) 서버 목록으로 맞춘다 — 그 사이 다른 사람이 바꾼 것도 반영된다.
export function useReorderProjectStatuses(projectKey: string) {
  const qc = useQueryClient();
  const key = projectStatusesKey(projectKey);
  return useMutation({
    mutationFn: (body: ReorderProjectStatusesBody) => reorderProjectStatuses(projectKey, body),
    onMutate: async (body) => {
      // 진행 중인 조회가 낙관적 값을 덮어쓰지 않게 먼저 멈춘다.
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ProjectStatus[]>(key);
      if (previous) qc.setQueryData<ProjectStatus[]>(key, applyCategoryOrder(previous, body.category, body.statusIds));
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error('순서를 바꾸지 못했어요');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

// OWNER — 상태 삭제(이슈를 moveTo 로 옮긴다). 실패 문구(마지막 상태 409 등)는 호출부 삭제 창이 보인다.
// 성공하면 상태 목록과 그 프로젝트의 이슈(검색·상세 — 상태 이름·범주가 바뀐다)·저장된 뷰(필터가 다시 써진다)와
// 고정된 뷰(사이드바 — 같은 저장된 뷰 쿼리를 싣는다, SSE project-status op=deleted 규칙과 같다)를 다시 받는다.
// 기다리는 것은 상태 목록뿐이다 — 삭제 창이 이슈 검색 재조회까지 기다리며 열려 있지 않게. 나머지는 뒤에서 받는다(SSE 도 무효화한다).
export function useDeleteProjectStatus(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; moveTo?: number }) => deleteProjectStatus(projectKey, v.id, v.moveTo),
    onSuccess: () => {
      const statuses = qc.invalidateQueries({ queryKey: projectStatusesKey(projectKey) });
      for (const queryKey of [['issues', 'search', projectKey], ['issues', projectKey], ['savedViews', projectKey], ['pinnedViews']]) {
        void qc.invalidateQueries({ queryKey });
      }
      return statuses;
    },
  });
}

// 상태별 이슈 수를 셀 때의 빈 필터 — 서버 group-counts 는 필터가 없으면 활성 이슈 전체를 센다(휴지통 제외, Task 4).
const NO_FILTERS: IssueFilters = {
  q: '',
  statuses: [],
  statusIds: [],
  priorities: [],
  assigneeIds: [],
  includeUnassigned: false,
  dueFrom: null,
  dueTo: null,
  closedIn: null,
  labelIds: [],
  cycleIds: [],
  componentIds: [],
  componentNone: false,
  fixVersionIds: [],
  fixVersionNone: false,
  affectsVersionIds: [],
  affectsVersionNone: false,
  milestoneIds: [],
  typeIds: [],
  parentNumber: null,
  topLevel: false,
  blocked: false,
  excludeSubtasks: false,
  showAllClosed: false,
};

/**
 * 상태별 활성 이슈 수(statusId → 수) — 설정 「상태」 행의 이슈 수. 아직 받지 못했으면 undefined(칸을 비운다),
 * 받은 뒤 0건 상태는 키가 없다(호출부가 0 으로 본다 — 서버가 0건 묶음을 빼고 줄 수 있어서).
 * 키를 이슈 검색 prefix(['issues','search',key]) 아래에 둬 이슈 변경·상태 삭제 무효화가 함께 다시 받게 한다.
 */
export function useStatusIssueCounts(projectKey: string): Record<number, number> | undefined {
  const { data } = useQuery({
    queryKey: ['issues', 'search', projectKey, 'group-counts', 'statusId', 'all'],
    queryFn: () => getIssueGroupCounts(projectKey, NO_FILTERS, 'statusId'),
    enabled: !!projectKey,
  });
  return useMemo(() => {
    if (!data) return undefined;
    const out: Record<number, number> = {};
    for (const g of data.groups) if (g.key != null) out[Number(g.key)] = g.count;
    return out;
  }, [data]);
}
