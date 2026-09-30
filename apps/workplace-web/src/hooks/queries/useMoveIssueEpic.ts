// 에픽 드래그 앤 드롭 전용 — 이슈의 부모 에픽 변경 mutation.
// onMutate 에서 검색 캐시(['issues','search',key] prefix, 보드 컬럼·목록·에픽 패널 공통)의 해당 이슈 parent 를 먼저 바꿔
// 카드/행의 에픽 칩을 즉시 갱신하고, 실패 시 스냅샷 복원 + 서버 메시지 토스트.
// 부모는 단일값이라 되돌리기는 이전 부모로 같은 PATCH 를 한 번 더 보내면 된다(대칭 — 사이클 이동과 달리 역차분 불필요).
// 목록에서 범위를 벗어난 행(예: 특정 에픽 보기에서 다른 에픽으로 이동)은 낙관적으로 빼지 않는다 — settle 재조회로 정리(#881: 낙관적 제거는 깜빡임).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { updateIssueParent } from '../../api/issueParent';
import { handleApiError } from '../../lib/api-error';
import type { IssueResponse, ParentRef } from '../../types/issue';
import { findIssueInSearchCache, patchIssueInSearchCache } from './issueSearchCache';

type MoveVars = {
  issue: IssueResponse;
  // 도착 에픽(null = 미할당으로 해제)
  to: ParentRef | null;
  // 되돌리기 요청이면 되돌리기 토스트를 다시 띄우지 않는다
  isUndo?: boolean;
};

export function useMoveIssueEpic(projectKey: string) {
  const qc = useQueryClient();
  const searchKey = ['issues', 'search', projectKey];
  const mutation = useMutation({
    mutationFn: ({ issue, to }: MoveVars) => updateIssueParent(projectKey, issue.number, to?.number ?? null),
    onMutate: ({ issue, to }) => patchIssueInSearchCache(qc, projectKey, issue.number, { parent: to }),
    onError: (err, _vars, ctx) => {
      ctx?.restore();
      handleApiError(err, '에픽 변경에 실패했습니다');
    },
    onSuccess: (_data, { issue, to, isUndo }) => {
      if (isUndo) {
        toast.success('되돌렸습니다');
        return;
      }
      const from = issue.parent;
      toast.success(to ? `「${to.title}」에 연결했습니다` : '에픽 연결을 해제했습니다', {
        action: {
          label: '되돌리기',
          onClick: () => {
            // 이 토스트 이후 같은 이슈가 다시 옮겨졌다면(X→Y→Z) 옛 부모로 되돌리면 최신 이동을 조용히 잃는다 — 클릭 시점의
            // 캐시상 현재 부모가 이 토스트의 도착지와 다를 때는 실행하지 않고 안내만 한다. 캐시에 없으면(퇴출) 그대로 진행.
            const current = findIssueInSearchCache(qc, projectKey, issue.number);
            if (current && (current.parent?.number ?? null) !== (to?.number ?? null)) {
              toast.info('이후에 다시 옮겨져 되돌릴 수 없습니다');
              return;
            }
            mutation.mutate({ issue: { ...issue, parent: to }, to: from, isUndo: true });
          },
        },
      });
    },
    onSettled: () => {
      // 에픽 패널 진행률(childCount)도 같은 prefix 라 함께 갱신된다.
      qc.invalidateQueries({ queryKey: searchKey });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
    },
  });
  return mutation;
}
