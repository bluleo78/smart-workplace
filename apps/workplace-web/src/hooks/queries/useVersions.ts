// 프로젝트 버전(WP-888) 조회 + 관리 mutation.
// 쿼리 키 ['versions', projectKey] 는 실시간 무효화 규칙(resourceInvalidation 의 version)과 같아야 다른 탭이 따라온다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { searchIssues } from '../../api/issues';
import {
  createVersion,
  deleteVersion,
  getVersionIssueCount,
  listVersions,
  releaseVersion,
  replaceIssueVersions,
  unreleaseVersion,
  updateVersion,
} from '../../api/versions';
import { handleApiError } from '../../lib/api-error';
import { parseFilters } from '../../lib/issueFilters';
import type { IssueResponse } from '../../types/issue';
import type {
  CreateVersionRequest,
  ReleaseVersionRequest,
  ReplaceIssueVersionsRequest,
  UpdateVersionRequest,
} from '../../types/version';
import { refreshStatusesOnUnknown } from './useProjectStatuses';

/** 버전 쿼리 키. */
export const versionKeys = {
  all: (projectKey: string) => ['versions', projectKey] as const,
  count: (projectKey: string, id: number) => ['versions', projectKey, 'count', id] as const,
  issues: (projectKey: string, kind: VersionIssueKind, id: number) =>
    ['versions', projectKey, 'issues', kind, id] as const,
};

/** 상세 이슈 탭의 종류 — 검색 API 의 필터 파라미터 이름과 같다(fixVersion = 이 버전에 나가는 것, affectsVersion = 이 버전에서 난 결함). */
export type VersionIssueKind = 'fixVersion' | 'affectsVersion';

const PAGE_SIZE = 100;

/**
 * 버전에 붙은 이슈 전부 — 검색 API 를 커서로 끝까지 읽는다(상세는 유형별로 묶어 보여 줘 일부만 읽으면 묶음이 틀어진다).
 * 키를 ['versions', pk, …] 아래에 둔다: 이슈 검색 캐시(['issues','search',pk])는 무한 쿼리 모양을 가정하는 낙관적 갱신이 훑으므로 섞지 않고,
 * 이슈·버전 변경 이벤트는 둘 다 이 접두를 무효화한다(resourceInvalidation).
 */
export function useVersionIssues(projectKey: string, kind: VersionIssueKind, id: number) {
  return useQuery({
    queryKey: versionKeys.issues(projectKey, kind, id),
    queryFn: async ({ client }) => {
      const filters = parseFilters(new URLSearchParams());
      const all: IssueResponse[] = [];
      let cursor: string | null = null;
      // 서버가 hasMore 를 false 로 줄 때까지 — nextCursor 가 없으면 중단해 무한 루프를 막는다.
      for (;;) {
        const page = await searchIssues(projectKey, filters, cursor, PAGE_SIZE, { [kind]: String(id) });
        all.push(...page.items);
        // 모르는 상태(방금 다른 사용자가 만든 상태)가 있으면 상태 목록을 한 번 다시 받는다 — 이슈 검색(issueSearchOptions)과 같은 도우미.
        refreshStatusesOnUnknown(client, projectKey, page.items ?? []);
        if (!page.hasMore || !page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return all;
    },
    enabled: !!projectKey && Number.isFinite(id),
  });
}

/** 프로젝트 버전 전체(보관 포함, 목록 순서). enabled=false 면 요청하지 않는다(개인 프로젝트 등). */
export function useVersions(projectKey: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: versionKeys.all(projectKey),
    queryFn: () => listVersions(projectKey),
    enabled: !!projectKey && (options?.enabled ?? true),
  });
}

/** 붙은 이슈 수 — 대화상자가 열려 있을 때만 읽는다. */
export function useVersionIssueCount(projectKey: string, id: number | null) {
  return useQuery({
    queryKey: versionKeys.count(projectKey, id ?? 0),
    queryFn: () => getVersionIssueCount(projectKey, id as number),
    enabled: !!projectKey && id != null,
    // 출시·삭제 판단에 쓰이므로 열 때마다 반드시 새로 읽는다(캐시된 옛 수로 되돌릴 수 없는 작업을 하지 않게).
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

// 버전의 이름·상태는 이슈 칩에도 보이고, 출시·삭제는 이슈를 옮기므로 이슈 화면도 다시 읽는다.
function invalidateAll(qc: ReturnType<typeof useQueryClient>, projectKey: string) {
  qc.invalidateQueries({ queryKey: versionKeys.all(projectKey) });
  qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
  qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
}

/** 버전 관리 mutation 공통 배선 — 성공하면 버전·이슈 화면을 다시 읽는다(무효화는 기다리지 않아 mutateAsync 가 바로 끝난다). */
function useVersionMutation<TVars, TData>(projectKey: string, mutationFn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      invalidateAll(qc, projectKey);
    },
  });
}

/** 추가 — 실패 문구는 대화창이 안에 보인다(구성요소 편집 창과 같은 방식이라 토스트를 겹쳐 띄우지 않는다). */
export function useCreateVersion(projectKey: string) {
  return useVersionMutation(projectKey, (body: CreateVersionRequest) => createVersion(projectKey, body));
}

/** 부분 수정 — 편집 저장·보관·복원이 같이 쓴다. 성공·실패 안내는 호출부가 정한다. */
export function useUpdateVersion(projectKey: string) {
  return useVersionMutation(projectKey, (v: { id: number; body: UpdateVersionRequest }) =>
    updateVersion(projectKey, v.id, v.body),
  );
}

/** 출시 — 이슈를 옮길 수 있어 이슈 화면까지 다시 읽는다. */
export function useReleaseVersion(projectKey: string) {
  return useVersionMutation(projectKey, (v: { id: number; body: ReleaseVersionRequest }) =>
    releaseVersion(projectKey, v.id, v.body),
  );
}

/** 출시 취소. */
export function useUnreleaseVersion(projectKey: string) {
  return useVersionMutation(projectKey, (id: number) => unreleaseVersion(projectKey, id));
}

/** 삭제 — 붙어 있던 이슈에서 빠지거나 옮겨지므로 이슈 화면까지 다시 읽는다. */
export function useDeleteVersion(projectKey: string) {
  return useVersionMutation(projectKey, (v: { id: number; moveTo?: number | null }) =>
    deleteVersion(projectKey, v.id, v.moveTo),
  );
}

/** 이슈 수정 버전·영향 버전 교체 — 이슈 칩·목록과 버전별 진행·이슈 수가 바뀐다. */
export function useUpdateIssueVersions(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReplaceIssueVersionsRequest) => replaceIssueVersions(projectKey, number, body),
    onSuccess: () => {
      invalidateAll(qc, projectKey);
      toast.success('버전을 저장했어요');
    },
    onError: (e) => handleApiError(e, '버전 저장에 실패했습니다'),
  });
}
