// 이슈 관계·외부 링크 쓰기 훅과 관계 대상 찾기(WP-887).
// 성공하면 이 이슈 상세(+ 다른 쪽 이슈 상세)를 무효화해 레일·이력을 다시 받는다. 실패는 토스트, 창은 호출 측이 열어 둔다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { issueRelationsApi } from '../../api/issueRelations';
import { handleApiError } from '../../lib/api-error';
import type { AddIssueRelationRequest, SaveIssueExternalLinkRequest } from '../../types/issue';
import { issueKeys } from './useIssues';

/** 찾기 결과 캐시 키 — 같은 검색어·출발 프로젝트면 다시 묻지 않는다. */
const lookupKey = (q: string, from: string) => ['issue-lookup', from, q] as const;

/**
 * 관계 대상 찾기 — 키(WPV-28)·번호(#12)·제목. q 는 호출 측이 디바운스해서 넘긴다. 빈 검색어는 묻지 않는다.
 * 결과엔 현재 이슈 자신도 섞일 수 있어 호출 측이 거른다.
 */
export function useIssueLookup(q: string, from: string, enabled = true) {
  const query = q.trim();
  return useQuery({
    queryKey: lookupKey(query, from),
    queryFn: () => issueRelationsApi.lookup(query, from),
    enabled: enabled && query.length > 0,
    staleTime: 30 * 1000,
  });
}

/** 이 이슈와 (있으면) 상대 이슈 상세를 무효화한다 — 관계 이력이 두 이슈 모두에 남고 레일도 양쪽에 보인다. */
function useInvalidateIssues(projectKey: string, number: number) {
  const qc = useQueryClient();
  return (other?: { projectKey: string; number: number }) => {
    void qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
    if (other) void qc.invalidateQueries({ queryKey: issueKeys.detail(other.projectKey, other.number) });
  };
}

/** 이슈 사이 관계 걸기(차단 제외 — 차단은 의존성 훅). */
export function useAddIssueRelation(projectKey: string, number: number) {
  const invalidate = useInvalidateIssues(projectKey, number);
  return useMutation({
    mutationFn: (body: AddIssueRelationRequest) => issueRelationsApi.addRelation(projectKey, number, body),
    onSuccess: (_d, body) => {
      invalidate(body.target);
      toast.success('관계를 추가했습니다');
    },
    onError: (e) => handleApiError(e, '관계를 추가하지 못했습니다'),
  });
}

/** 관계 지우기 — other 는 상대 이슈(상세 무효화용). */
export function useRemoveIssueRelation(projectKey: string, number: number) {
  const invalidate = useInvalidateIssues(projectKey, number);
  return useMutation({
    mutationFn: (v: { relationId: number; other: { projectKey: string; number: number } }) =>
      issueRelationsApi.removeRelation(projectKey, number, v.relationId),
    onSuccess: (_d, v) => {
      invalidate(v.other);
      toast.success('관계를 제거했습니다');
    },
    onError: (e) => handleApiError(e, '관계를 제거하지 못했습니다'),
  });
}

/** 외부 링크 붙이기. */
export function useAddIssueExternalLink(projectKey: string, number: number) {
  const invalidate = useInvalidateIssues(projectKey, number);
  return useMutation({
    mutationFn: (body: SaveIssueExternalLinkRequest) => issueRelationsApi.addExternalLink(projectKey, number, body),
    onSuccess: () => {
      invalidate();
      toast.success('외부 링크를 추가했습니다');
    },
    onError: (e) => handleApiError(e, '외부 링크를 추가하지 못했습니다'),
  });
}

/** 외부 링크 고치기(유형·방향·키·제목). */
export function useUpdateIssueExternalLink(projectKey: string, number: number) {
  const invalidate = useInvalidateIssues(projectKey, number);
  return useMutation({
    mutationFn: (v: { linkId: number; body: SaveIssueExternalLinkRequest }) =>
      issueRelationsApi.updateExternalLink(projectKey, number, v.linkId, v.body),
    onSuccess: () => {
      invalidate();
      toast.success('외부 링크를 고쳤습니다');
    },
    onError: (e) => handleApiError(e, '외부 링크를 고치지 못했습니다'),
  });
}

/** 외부 링크 지우기. */
export function useRemoveIssueExternalLink(projectKey: string, number: number) {
  const invalidate = useInvalidateIssues(projectKey, number);
  return useMutation({
    mutationFn: (linkId: number) => issueRelationsApi.removeExternalLink(projectKey, number, linkId),
    onSuccess: () => {
      invalidate();
      toast.success('외부 링크를 제거했습니다');
    },
    onError: (e) => handleApiError(e, '외부 링크를 제거하지 못했습니다'),
  });
}
