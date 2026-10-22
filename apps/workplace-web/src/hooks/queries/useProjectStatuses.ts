// 프로젝트 상태(WP-808) 쿼리/뮤테이션 훅 — 목록 + OWNER 전용 추가·이름 변경.
// 쿼리 키 ['projectStatuses', projectKey] 는 SSE 'project-status' 무효화 규칙(lib/resourceInvalidation)과 같아야 한다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

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

// 상태가 바뀌면 상태 목록과, 상태 이름을 싣고 있는 이슈 검색 캐시를 함께 다시 받는다.
// 상태 목록 재조회 promise 를 돌려준다 — onSuccess 가 돌려주면 mutateAsync 가 새 목록이 캐시에 들어온 뒤 끝나,
// 호출부가 새 상태를 바로 고를 수 있다(모바일 보드 새 탭 선택). 이슈 검색 재조회는 기다리지 않는다.
function useInvalidateStatuses(projectKey: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
    return qc.invalidateQueries({ queryKey: ['projectStatuses', projectKey] });
  };
}

// OWNER — 상태 추가. 실패 문구(중복·길이)는 인라인 편집기가 입력 아래 보이므로 토스트를 띄우지 않는다.
export function useCreateProjectStatus(projectKey: string) {
  const invalidate = useInvalidateStatuses(projectKey);
  return useMutation({
    mutationFn: (body: CreateProjectStatusBody) => createProjectStatus(projectKey, body),
    onSuccess: invalidate,
  });
}

// OWNER — 상태 이름 변경. 실패 문구는 호출부(인라인 편집기)가 보인다.
// 응답으로 목록 캐시의 그 상태를 바로 바꾼다 — 재조회를 기다리는 동안 보드 헤더가 옛 이름으로 돌아가 보이지 않게(범주·순서는 그대로라 안전).
export function useRenameProjectStatus(projectKey: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateStatuses(projectKey);
  return useMutation({
    mutationFn: (v: { id: number; body: RenameProjectStatusBody }) => renameProjectStatus(projectKey, v.id, v.body),
    onSuccess: (saved) => {
      qc.setQueryData<ProjectStatus[]>(['projectStatuses', projectKey], (list) =>
        list?.map((s) => (s.id === saved.id ? { ...s, name: saved.name } : s)),
      );
      void invalidate();
    },
  });
}
