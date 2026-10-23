// 프로젝트 상태(WP-808) 쿼리/뮤테이션 훅 — 목록 + OWNER 전용 추가·이름 변경.
// 쿼리 키 ['projectStatuses', projectKey] 는 SSE 'project-status' 무효화 규칙(lib/resourceInvalidation)과 같아야 한다.

import { type InfiniteData, type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
  createProjectStatus,
  type CreateProjectStatusBody,
  listProjectStatuses,
  renameProjectStatus,
  type RenameProjectStatusBody,
} from '../../api/projectStatuses';
import type { IssueDetailResponse, IssueResponse, IssueSearchResponse, IssueStatus } from '../../types/issue';
import type { ProjectStatus } from '../../types/projectStatus';

// 프로젝트의 상태 목록 — projectKey 가 아직 없으면(라우트 로딩 중) 조회하지 않는다.
// 목록이 도착·갱신되면 이미 캐시된 이슈 검색 페이지에 모르는 상태가 있는지 다시 본다 — 이슈 검색이 목록보다 먼저 와
// 그때는 판정을 건너뛰었더라도(refreshStatusesOnUnknown 참고) 목록이 온 뒤 한 번 더 물을 수 있게.
export function useProjectStatuses(projectKey?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['projectStatuses', projectKey],
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
const NO_STATUSES: ProjectStatus[] = [];

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
  const statuses = client.getQueryData<ProjectStatus[]>(['projectStatuses', projectKey]);
  if (!statuses) return;
  const { asked } = statusCheckFor(client, statuses);
  const fresh = unknownStatusIds(issues, statuses).filter((id) => !asked.has(id));
  if (fresh.length === 0) return;
  fresh.forEach((id) => asked.add(id));
  void client.invalidateQueries({ queryKey: ['projectStatuses', projectKey] });
}

/**
 * 상태 이름이 바뀌면 그 상태를 쓰는 이슈의 statusName 을 캐시에서 제자리로 고친다 — 검색(보드·목록) 캐시와 이슈 상세 요약.
 * 이슈 검색 전체를 다시 받지 않는다(이름 말고는 바뀐 것이 없다). 그 상태의 이슈가 없는 캐시는 그대로 둔다.
 * 그 밖에 statusName 을 싣는 교차 프로젝트 이슈 목록(내 이슈·워치·AI 작업·홈 위젯)은 SSE project-status 규칙(lib/resourceInvalidation)이
 * 행위자 탭을 포함한 모든 화면에서 다시 받게 한다.
 */
function patchStatusNameInIssueCaches(qc: QueryClient, projectKey: string, statusId: number, name: string) {
  const rename = (it: IssueResponse) => (it.statusId === statusId ? { ...it, statusName: name } : it);
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
  const renameMutation = useRenameProjectStatus(projectKey);
  // mutateAsync 는 렌더마다 같은 참조라 이것을 deps 로 둔다(useMutation 결과 객체는 매번 새로 만들어져 memo 를 깬다).
  const createAsync = create.mutateAsync;
  const renameAsync = renameMutation.mutateAsync;
  return useMemo(
    () => ({
      statuses,
      rename: async (id: number, name: string) => {
        await renameAsync({ id, body: { name } });
      },
      addAfter: (after: ProjectStatus, name: string) =>
        createAsync({ name, category: after.category, afterStatusId: after.id }),
      addAt: async (category: IssueStatus, name: string) => {
        await createAsync({ name, category });
      },
    }),
    [statuses, renameAsync, createAsync],
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projectStatuses', projectKey] }),
  });
}

// OWNER — 상태 이름 변경. 실패 문구는 호출부(인라인 편집기)가 보인다.
// 응답으로 목록 캐시의 그 상태와 그 상태를 쓰는 이슈의 이름을 제자리로 바꾼다(범주·순서는 그대로라 안전) —
// 상태 목록을 다시 받지 않는다(다른 화면은 SSE project-status 무효화가 맞춘다).
export function useRenameProjectStatus(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: RenameProjectStatusBody }) => renameProjectStatus(projectKey, v.id, v.body),
    onSuccess: (saved) => {
      qc.setQueryData<ProjectStatus[]>(['projectStatuses', projectKey], (list) =>
        list?.map((s) => (s.id === saved.id ? { ...s, name: saved.name } : s)),
      );
      patchStatusNameInIssueCaches(qc, projectKey, saved.id, saved.name);
    },
  });
}
