// 사이클 페이지 드래그 이동 mutation (#881) — from 사이클 해제 + to 사이클 추가(그 외 연결 유지), null=백로그.
// onMutate 에서 출발·도착 섹션 캐시만 정확히 패치(행 즉시 이동)하고, 실패 시 스냅샷 복원 + 토스트.
// 성공 토스트의 "되돌리기"는 서버가 돌려준 실제 차분만 역적용한다 — 이동은 대칭이 아니다
// (예: {A,B} 에서 A→B 는 B 가 이미 있어 {B}; from/to 를 뒤집으면 {A} 가 되어 B 연결을 잃는다).

import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { moveIssueCycle } from '../../api/cycles';
import { handleApiError } from '../../lib/api-error';
import type { IssueResponse, IssueSearchResponse } from '../../types/issue';
import {
  backlogSectionFilters,
  type SectionCycleId,
  sectionQueryKey,
} from './useCycleSectionIssues';

/** 이동 요청 — 사용자 드래그(토스트 문구·되돌리기 판단용 정보 포함) 또는 되돌리기(추가 정보 없음). */
export type MoveIssueCycleVars = {
  issue: IssueResponse;
  from: SectionCycleId;
  to: SectionCycleId;
} & (
  | {
      undo?: false;
      /** 토스트 문구용 섹션 이름. */
      fromName: string;
      toName: string;
      /** 출발이 완료 사이클 — 되돌리면 완료 사이클로 재연결해야 해서 서버가 거부하므로 되돌리기를 달지 않는다. */
      fromCompleted: boolean;
    }
  | { undo: true }
);

type SearchData = InfiniteData<IssueSearchResponse>;

// 백로그 섹션은 미종료(TODO·진행 중)만 보여준다 — 종료 이슈를 백로그로 보내면 목록에 나타나지 않는다.
const BACKLOG_STATUSES = new Set(backlogSectionFilters().statuses);

export function useMoveIssueCycle(projectKey: string) {
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: ({ issue, from, to }: MoveIssueCycleVars) =>
      moveIssueCycle(projectKey, issue.number, from, to),
    onMutate: async ({ issue, from, to }) => {
      const fromKey = sectionQueryKey(projectKey, from);
      const toKey = sectionQueryKey(projectKey, to);
      // 진행 중인 섹션 요청이 낙관적 패치를 덮어쓰지 않게 멈춘다.
      await Promise.all([
        qc.cancelQueries({ queryKey: fromKey, exact: true }),
        qc.cancelQueries({ queryKey: toKey, exact: true }),
      ]);
      const snapshots = [fromKey, toKey].map((k) => [k, qc.getQueryData<SearchData>(k)] as const);

      // 출발 섹션에서 행 제거.
      qc.setQueryData<SearchData>(fromKey, (old) =>
        old && {
          ...old,
          pages: old.pages.map((p) => ({ ...p, items: p.items.filter((it) => it.id !== issue.id) })),
        },
      );
      // 도착 사이클 섹션(펼쳐져 캐시가 있을 때만) 맨 앞에 삽입 — 중복 방지.
      // 백로그는 즉시 넣지 않는다: 이슈가 다른 사이클에도 속해 있으면 여전히 백로그 밖이라(행 정보엔 사이클 집합이 없다)
      // 넣었다가 재조회 때 사라지는 깜빡임이 생긴다. 백로그 행은 onSettled 재조회가 서버 기준으로 채운다.
      if (to != null) {
        qc.setQueryData<SearchData>(toKey, (old) => {
          if (!old || old.pages.length === 0) return old;
          if (old.pages.some((p) => p.items.some((it) => it.id === issue.id))) return old;
          const [first, ...rest] = old.pages;
          return { ...old, pages: [{ ...first, items: [issue, ...first.items] }, ...rest] };
        });
      }
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      handleApiError(err, '사이클 이동에 실패했습니다');
    },
    onSuccess: (result, vars) => {
      // 이동 결과 집합을 상세 레일 사이클 피커 캐시에 바로 반영(재조회 불요).
      qc.setQueryData(['issueCycles', projectKey, vars.issue.number], result.cycles);
      const label = `${projectKey}-${vars.issue.number}`;
      if (vars.undo) {
        toast.success(`${label} 이동을 되돌렸습니다`);
        return;
      }
      // 백로그로 보냈는데 백로그에 나타나지 않는 두 경우(다른 사이클에 남음 / 종료 이슈)는 이유를 알린다.
      let message = `${label} 을(를) ${vars.toName}(으)로 옮겼습니다`;
      if (vars.to == null) {
        const reason =
          result.cycles.length > 0
            ? '다른 사이클에 남아 있어'
            : !BACKLOG_STATUSES.has(vars.issue.status)
              ? '완료된 이슈라'
              : null;
        if (reason) message = `${label} 을(를) ${vars.fromName}에서 뺐습니다 (${reason} 백로그에는 표시되지 않습니다)`;
      }
      // 역차분 — 붙인 to 만 떼고, 뗀 from 만 다시 붙인다. 실제 변화가 없었거나 완료 사이클 재연결이 필요하면 되돌리기 없음.
      const undoFrom = result.addedTo ? vars.to : null;
      const undoTo = result.removedFrom ? vars.from : null;
      const canUndo = (undoFrom != null || undoTo != null) && !(undoTo != null && vars.fromCompleted);
      toast.success(
        message,
        canUndo
          ? {
              action: {
                label: '되돌리기',
                onClick: () => move.mutate({ issue: vars.issue, from: undoFrom, to: undoTo, undo: true }),
              },
            }
          : undefined,
      );
    },
    onSettled: (_data, _err, { from, to }) => {
      // 바뀐 두 섹션과 진행률만 서버 기준으로 재동기화 — 다른 화면의 검색 캐시는 SSE resource.changed 가 무효화한다.
      qc.invalidateQueries({ queryKey: sectionQueryKey(projectKey, from), exact: true });
      qc.invalidateQueries({ queryKey: sectionQueryKey(projectKey, to), exact: true });
      qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
    },
  });
  return move;
}
