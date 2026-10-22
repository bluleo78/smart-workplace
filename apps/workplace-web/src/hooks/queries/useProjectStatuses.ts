// 프로젝트 상태(WP-808) 쿼리/뮤테이션 훅 — 목록 + OWNER 전용 추가·이름 변경.
// 쿼리 키 ['projectStatuses', projectKey] 는 SSE 'project-status' 무효화 규칙(lib/resourceInvalidation)과 같아야 한다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createProjectStatus,
  type CreateProjectStatusBody,
  listProjectStatuses,
  renameProjectStatus,
  type RenameProjectStatusBody,
} from '../../api/projectStatuses';

// 프로젝트의 상태 목록 — projectKey 가 아직 없으면(라우트 로딩 중) 조회하지 않는다.
export function useProjectStatuses(projectKey?: string) {
  return useQuery({
    queryKey: ['projectStatuses', projectKey],
    queryFn: () => listProjectStatuses(projectKey!),
    enabled: !!projectKey,
  });
}

// 상태가 바뀌면 상태 목록과, 상태 이름을 싣고 있는 이슈 검색 캐시를 함께 다시 받는다.
function useInvalidateStatuses(projectKey: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['projectStatuses', projectKey] });
    qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
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
export function useRenameProjectStatus(projectKey: string) {
  const invalidate = useInvalidateStatuses(projectKey);
  return useMutation({
    mutationFn: (v: { id: number; body: RenameProjectStatusBody }) => renameProjectStatus(projectKey, v.id, v.body),
    onSuccess: invalidate,
  });
}
