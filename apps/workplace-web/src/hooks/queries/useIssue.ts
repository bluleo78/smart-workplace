// 이슈 단건 조회 + 수정 mutation 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import { issuesApi } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
import type { IssueDetailResponse, UpdateIssueRequest } from '../../types/issue';
import { issueKeys } from './useIssues';

export function useIssue(projectKey: string, number: number) {
  return useQuery({
    queryKey: issueKeys.detail(projectKey, number),
    queryFn: () => issuesApi.get(projectKey, number).then(r => r.data),
    enabled: !!projectKey && Number.isFinite(number),
  });
}

export function useUpdateIssue(projectKey: string, number: number) {
  const qc = useQueryClient();
  const detailKey = issueKeys.detail(projectKey, number);
  return useMutation({
    mutationFn: (data: UpdateIssueRequest) => {
      // 호출자가 version 을 주지 않으면 지금 보고 있는 상세 캐시의 version 을 싣는다 — 상세를 본 적 없는 화면은 검사 없이 저장된다.
      const version = data.version ?? qc.getQueryData<IssueDetailResponse>(detailKey)?.summary.version;
      return issuesApi.update(projectKey, number, { ...data, version }).then(r => r.data);
    },
    onSuccess: (updated) => {
      // 응답의 새 version 을 곧바로 상세 캐시에 반영한다 — 다음 저장이 리페치를 기다리지 않고 최신 version 을 쓰게.
      // (나머지 필드는 아래 무효화 리페치가 맞춘다.)
      const version = updated?.summary?.version;
      if (version !== undefined) {
        qc.setQueryData<IssueDetailResponse>(detailKey, (old) =>
          old ? { ...old, summary: { ...old.summary, version } } : old,
        );
      }
      // 단건 캐시 무효화
      qc.invalidateQueries({ queryKey: detailKey });
      // 검색/목록 캐시 무효화 —
      // 실제 목록·보드가 사용하는 issueKeys.search 키를 무효화한다 (#175).
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
      // 홈 합성 위젯의 마감 마커(useMyIssueDues, ['my-issue-dues', from, to])도 무효화 —
      // 마감일 변경이 홈 "오늘 마감" 카운트·주의 항목에 즉시 반영되도록 prefix 로 모든 날짜범위를 무효화한다.
      qc.invalidateQueries({ queryKey: ['my-issue-dues'] });
    },
    onError: (error) => {
      // 실패 안내는 훅이 한 번 띄운다 — 개인 작업 패널처럼 mutate 만 부르는 호출부도 실패를 알 수 있게.
      handleApiError(error, '변경에 실패했습니다');
      // #611 다른 편집이 먼저 반영됨(409) — 최신 이슈를 다시 불러와 화면과 version 을 맞춘다. 상세를 보고 있지 않은 화면(개인 체크리스트
      // 행 등)에서도 캐시의 옛 version 이 남아 409 가 반복되지 않도록 비활성 캐시까지 다시 불러오고(refetchType: 'all') 목록도 갱신한다.
      if (isAxiosError(error) && error.response?.status === 409) {
        qc.invalidateQueries({ queryKey: detailKey, refetchType: 'all' });
        qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
      }
    },
  });
}

// NOTE: useDeleteIssue 는 useIssues.ts 의 버전이 실제로 사용된다.
// 여기서 정의된 버전은 미사용 코드였으므로 제거 (#175).

// 이슈 AI 현황 요약 생성/재생성 mutation.
// 성공 시 이슈 상세 캐시를 무효화해 카드가 최신 summary 를 즉시 반영한다.
export function useGenerateAiSummary(projectKey: string, number: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => issuesApi.generateAiSummary(projectKey, number).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) }),
    onError: (e) => handleApiError(e, 'AI 요약 생성에 실패했습니다'),
  })
}
