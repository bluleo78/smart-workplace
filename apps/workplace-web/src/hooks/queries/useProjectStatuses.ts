// 프로젝트 상태(WP-808) 쿼리/뮤테이션 훅 — 목록 + OWNER 전용 추가·이름 변경.
// 쿼리 키 ['projectStatuses', projectKey] 는 SSE 'project-status' 무효화 규칙(lib/resourceInvalidation)과 같아야 한다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import {
  createProjectStatus,
  type CreateProjectStatusBody,
  listProjectStatuses,
  renameProjectStatus,
  type RenameProjectStatusBody,
} from '../../api/projectStatuses';
import { sortStatuses } from '../../lib/projectStatuses';
import type { ProjectStatus } from '../../types/projectStatus';

// 프로젝트의 상태 목록 — projectKey 가 아직 없으면(라우트 로딩 중) 조회하지 않는다.
export function useProjectStatuses(projectKey?: string) {
  return useQuery({
    queryKey: ['projectStatuses', projectKey],
    queryFn: () => listProjectStatuses(projectKey!),
    enabled: !!projectKey,
  });
}

// 로딩 중·키 없음일 때 돌려줄 고정 빈 배열 — 매 렌더 새 배열을 만들면 이것을 deps 로 쓰는 memo 가 매번 깨진다.
const NO_STATUSES: ProjectStatus[] = [];

/**
 * 표시 순서(범주 → position)로 정렬한 프로젝트 상태 목록 — 상태 선택·행 메뉴·모바일 시트·목록 그룹이 같은 순서를 쓴다.
 * 로딩 중이면 빈 배열이다. 프로젝트는 늘 기본 4상태를 가지므로 빈 배열 = 아직 모름(호출부가 숨김·범주 폴백을 정한다).
 */
export function useSortedProjectStatuses(projectKey?: string): ProjectStatus[] {
  const data = useProjectStatuses(projectKey).data;
  return useMemo(() => (data ? sortStatuses(data) : NO_STATUSES), [data]);
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

/**
 * 모르는 statusId 를 가진 이슈가 보이면 프로젝트 상태 목록을 한 번 다시 받는다(WP-808).
 * 왜: 그 상태 컬럼·버킷이 없어 보드에선 카드가 사라지고 목록에선 이름만 있는 버킷이 덧붙는다. 이슈 이벤트마다 상태 목록을 다시 받는 대신
 *     모르는 상태를 실제로 만났을 때만 받는다.
 * - 상태 목록을 받은 뒤에만 판정한다 — 로딩 중·실패면 모든 id 가 모르는 것으로 보여 바로 재조회하게 된다.
 * - 같은 id 는 한 번만 — 다시 받아도 없으면(지워진 상태 등) 반복 재조회하지 않는다. 렌더가 아니라 커밋 뒤(effect)에 무효화한다.
 */
export function useRefreshStatusesOnUnknown(projectKey: string | undefined, issues: readonly { statusId?: number | null }[]) {
  const qc = useQueryClient();
  const { data } = useProjectStatuses(projectKey);
  // 이미 다시 받게 한 「프로젝트:상태 id」 — 프로젝트를 옮겨 다녀도 섞이지 않게 키에 프로젝트를 붙인다.
  const asked = useRef(new Set<string>());
  const unknown = data && projectKey ? unknownStatusIds(issues, data).join(',') : '';
  useEffect(() => {
    if (!unknown || !projectKey) return;
    const fresh = unknown.split(',').filter((id) => !asked.current.has(`${projectKey}:${id}`));
    if (fresh.length === 0) return;
    fresh.forEach((id) => asked.current.add(`${projectKey}:${id}`));
    void qc.invalidateQueries({ queryKey: ['projectStatuses', projectKey] });
  }, [qc, projectKey, unknown]);
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
// 응답으로 목록 캐시의 그 상태를 바로 바꾼다 — 재조회를 기다리는 동안 보드 헤더가 옛 이름으로 돌아가 보이지 않게(범주·순서는 그대로라 안전).
export function useRenameProjectStatus(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: RenameProjectStatusBody }) => renameProjectStatus(projectKey, v.id, v.body),
    onSuccess: (saved) => {
      qc.setQueryData<ProjectStatus[]>(['projectStatuses', projectKey], (list) =>
        list?.map((s) => (s.id === saved.id ? { ...s, name: saved.name } : s)),
      );
      // 상태 목록과, 상태 이름을 싣고 있는 이슈 검색 캐시를 함께 다시 받는다.
      void qc.invalidateQueries({ queryKey: ['projectStatuses', projectKey] });
      void qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
    },
  });
}
