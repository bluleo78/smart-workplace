// 이슈 리스트 뷰 벌크 작업 훅 (#606) — 상태 일괄 변경/담당자 일괄 지정/우선순위 일괄 변경(WP-273)/일괄 삭제.
// 전용 벌크 백엔드 엔드포인트가 없어 기존 단건 엔드포인트(PATCH .../status, PUT .../assignees,
// DELETE .../{number})를 Promise.allSettled 로 병렬 순회한다(Drive #82 수정 방향 메모와 동일 전략).
// 부분 실패 시에도 성공한 항목은 반영하고, 실패 건수와 실패한 이슈 키를 토스트로 안내한다(WP-851 — 선택은 호출 쪽이 실패 건만 남긴다).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { replaceIssueAssignees } from '../../api/issueAssignees';
import { issuesApi, updateIssueStatus } from '../../api/issues';
import { type BulkLabels, bulkResultToast } from '../../lib/bulkResult';
import type { ClosedHidingNotice } from '../../lib/closedHiding';
import type { IssuePriority, IssueStatus } from '../../types/issue';
import { chatKeys } from './chatKeys';
import { toastStatusChange } from './closedHidingToast';
import { issueKeys } from './useIssues';
import { statusRequestBody } from './useUpdateIssueStatus';

// 성공/실패 건수를 세어 결과 토스트를 띄우는 공통 헬퍼 — 문구·종류 판단은 bulkResultToast(실패 사유 노출, #710).
function reportBulkResult(projectKey: string, numbers: number[], results: PromiseSettledResult<unknown>[], labels: BulkLabels) {
  const { level, message } = bulkResultToast(results, labels, issueKeysOf(projectKey, numbers));
  toast[level](message);
}

// 결과와 같은 순서의 이슈 키(RX-67) — 부분 실패 토스트가 어느 이슈인지 보이게 한다(WP-851).
const issueKeysOf = (projectKey: string, numbers: number[]) => numbers.map((n) => `${projectKey}-${n}`);

// 공통 무효화 — 검색/상세 캐시를 모두 갱신.
// 사이클 진행률도 함께 — 목록 사이클 구간 헤더(#878)가 행 바로 위에 진행률을 보이므로, 일괄 완료·삭제 직후
// 행만 바뀌고 진행률이 옛 값으로 남지 않게 한다(검색 키 패밀리 밖이라 자동으로 걸리지 않는다).
export function invalidateIssueCaches(qc: ReturnType<typeof useQueryClient>, projectKey: string) {
  qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
  qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
  qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
}

// closedHiding — 종료 이슈를 숨기는 화면이면, 바뀐 이슈 중 숨겨지는 것이 있을 때 결과 토스트에 이유와 「모두 보기」를 붙인다(WP-606).
export function useBulkUpdateStatus(projectKey: string, closedHiding?: ClosedHidingNotice) {
  const qc = useQueryClient();
  return useMutation({
    // statusId(WP-808) — 행 메뉴에서 프로젝트 상태를 골랐으면 그 상태로, 없으면(일괄 바) 범주의 기본 상태로 보낸다.
    // status(범주)는 statusId 가 있어도 함께 받는다 — 종료 숨김 토스트가 범주로 판정한다.
    mutationFn: async ({ numbers, status, statusId }: { numbers: number[]; status: IssueStatus; statusId?: number }) =>
      Promise.allSettled(
        numbers.map((n) => updateIssueStatus(projectKey, n, statusRequestBody(status, statusId))),
      ),
    onSuccess: (results, { numbers, status }) => {
      const { level, message } = bulkResultToast(
        results,
        { done: '상태를 변경했습니다', fail: '상태를 변경하지 못했습니다' },
        issueKeysOf(projectKey, numbers),
      );
      const changed = numbers.filter((_, i) => results[i]?.status === 'fulfilled');
      void toastStatusChange(projectKey, changed, status, closedHiding, level, message);
    },
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}

export function useBulkAssign(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    // userIds — 빈 배열이면 담당자 해제(미지정), 아니면 해당 집합으로 교체(단일 지정 UI 기준 1명).
    mutationFn: async ({ numbers, userIds }: { numbers: number[]; userIds: number[] }) =>
      Promise.allSettled(numbers.map((n) => replaceIssueAssignees(projectKey, n, userIds))),
    onSuccess: (results, { numbers }) => {
      // 담당 AI 가 바뀌면 이슈 챗 작성창 안내가 바뀐다 — 스레드 응답의 externalAgent (WP-373).
      qc.invalidateQueries({ queryKey: [...chatKeys.all, 'thread', projectKey] });
      reportBulkResult(projectKey, numbers, results, { done: '담당자를 지정했습니다', fail: '담당자를 지정하지 못했습니다' });
    },
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}

// 우선순위 일괄 변경(WP-273 행 메뉴의 다중 선택) — 일괄 바와 같은 allSettled 전략.
export function useBulkUpdatePriority(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ numbers, priority }: { numbers: number[]; priority: IssuePriority }) =>
      Promise.allSettled(numbers.map((n) => issuesApi.update(projectKey, n, { priority }))),
    onSuccess: (results, { numbers }) => reportBulkResult(projectKey, numbers, results, { done: '우선순위를 변경했습니다', fail: '우선순위를 변경하지 못했습니다' }),
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}

export function useBulkDeleteIssues(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (numbers: number[]) =>
      Promise.allSettled(numbers.map((n) => issuesApi.remove(projectKey, n))),
    onSuccess: (results, numbers) => reportBulkResult(projectKey, numbers, results, { done: '삭제했습니다', fail: '삭제하지 못했습니다' }),
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}
