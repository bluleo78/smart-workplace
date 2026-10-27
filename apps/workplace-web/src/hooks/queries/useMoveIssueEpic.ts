// 에픽 드래그 앤 드롭 전용 — 이슈의 부모 에픽 변경 mutation.
// onMutate 에서 검색 캐시(['issues','search',key] prefix, 보드 컬럼·목록·에픽 패널 공통)의 해당 이슈 parent 를 먼저 바꿔
// 카드/행의 에픽 칩을 즉시 갱신하고, 실패 시 스냅샷 복원 + 서버 메시지 토스트.
// 부모는 단일값이라 되돌리기는 이전 부모로 같은 PATCH 를 한 번 더 보내면 된다(대칭 — 사이클 이동과 달리 역차분 불필요).
// 이전 부모가 다른 프로젝트 에픽이면 그 키로 되돌리고(WP-1039), 가려진 에픽이면 키를 몰라 되돌리기를 두지 않는다.
// 목록에서 범위를 벗어난 행(예: 특정 에픽 보기에서 다른 에픽으로 이동)은 낙관적으로 빼지 않는다 — settle 재조회로 정리(#881: 낙관적 제거는 깜빡임).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { updateIssueParent } from '../../api/issueParent';
import { handleApiError } from '../../lib/api-error';
import { isHiddenParent, isSameParent } from '../../lib/parentRef';
import type { IssueResponse, ParentRef } from '../../types/issue';
import { findIssueInSearchCache, patchIssueInSearchCache } from './issueSearchCache';
import { invalidateParentChange } from './useUpdateIssueParent';

type MoveVars = {
  issue: IssueResponse;
  // 도착 에픽(null = 미할당으로 해제)
  to: ParentRef | null;
  // 되돌리기 요청이면 되돌리기 토스트를 다시 띄우지 않는다
  isUndo?: boolean;
};

export function useMoveIssueEpic(projectKey: string) {
  const qc = useQueryClient();
  const mutation = useMutation({
    // 도착 에픽의 projectKey 가 있으면(다른 프로젝트 에픽 — 되돌리기의 이전 부모) parentKey 로 보낸다.
    mutationFn: ({ issue, to }: MoveVars) => updateIssueParent(projectKey, issue.number, to),
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
      const message = to ? `「${to.title}」에 연결했습니다` : '에픽 연결을 해제했습니다';
      // 가려진 이전 부모(볼 수 없는 에픽)는 키를 몰라 다시 연결할 수 없다 — 되돌리기 없이 결과만 알린다.
      if (from && isHiddenParent(from)) {
        toast.success(message);
        return;
      }
      toast.success(message, {
        action: {
          label: '되돌리기',
          onClick: () => {
            // 이 토스트 이후 같은 이슈가 다시 옮겨졌다면(X→Y→Z) 옛 부모로 되돌리면 최신 이동을 조용히 잃는다 — 클릭 시점의
            // 캐시상 현재 부모가 이 토스트의 도착지와 다를 때는 실행하지 않고 안내만 한다. 캐시에 없으면(퇴출) 그대로 진행.
            const current = findIssueInSearchCache(qc, projectKey, issue.number);
            // 번호만 비교하면 다른 프로젝트 에픽 CLA-5 와 이 프로젝트 에픽 #5 를 같은 곳으로 본다 — 프로젝트까지 비교한다(WP-1039).
            if (current && !isSameParent(current.parent, to, projectKey)) {
              toast.info('이후에 다시 옮겨져 되돌릴 수 없습니다');
              return;
            }
            mutation.mutate({ issue: { ...issue, parent: to }, to: from, isUndo: true });
          },
        },
      });
    },
    onSettled: (_data, _err, { issue, to }) => {
      // 이 프로젝트 검색(보드 컬럼·목록·에픽 패널 진행률)과 상세, 그리고 출발·도착 에픽이 다른 프로젝트면(되돌리기 포함, WP-1039) 그 프로젝트의
      // 에픽 상세와 그 프로젝트 검색(에픽 행 하위 수·하위 목록)까지 갱신한다 — 상위 에픽 고르기와 같은 invalidateParentChange.
      invalidateParentChange(qc, projectKey, [issue.parent, to]);
    },
  });
  return mutation;
}
