// 이슈 목록 사이클 구간 드래그 이동 mutation (#881) — 출발 구간 사이클 해제 + 도착 구간 사이클 추가(그 외 연결 유지).
// null 사이클 = 백로그(진행 중·예정 사이클 밖). 서버 POST /issues/{n}/cycles/move 가 원자적으로 처리한다.
// 낙관적 반영: 출발 구간 캐시에서 행 제거, 도착 사이클 구간(펼쳐져 캐시가 있을 때) 맨 앞에 삽입. 실패 시 스냅샷 복원.
// 되돌리기: 서버가 돌려준 실제 차분만 역적용한다 — 이동은 대칭이 아니다
// (예: {A,B} 에서 A→B 는 B 가 이미 있어 {B}; from/to 를 뒤집으면 {A} 가 되어 B 연결을 잃는다).
import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { moveIssueCycle } from '../../api/cycles';
import { handleApiError } from '../../lib/api-error';
import type { CycleSectionRef } from '../../lib/epicDnd';
import type { IssueResponse, IssueSearchResponse } from '../../types/issue';

type SearchData = InfiniteData<IssueSearchResponse>;

// from/to 가 null 이면 "사이클 없음 + 건드릴 구간 캐시 없음" — 되돌리기에서 차분이 없는 쪽(원래 연결이라 그대로 둘 쪽)에 쓴다.
// (예: {A,B} 에서 A→B 를 되돌리면 B 는 원래 연결이라 B 구간 행을 낙관적으로 빼면 안 된다.)
export type MoveIssueCycleVars = {
  issue: IssueResponse;
  from: CycleSectionRef | null;
  to: CycleSectionRef | null;
  /** 되돌리기로 호출된 이동 — 다시 되돌리기 액션을 달지 않는다. */
  undo?: boolean;
};

// 종료 상태 — 백로그는 기본 스코프에서 종료 이슈를 숨기므로, 종료 이슈를 백로그로 보내면 보이지 않을 수 있다.
const CLOSED_STATUSES = new Set(['DONE', 'CANCELED']);

// 구간 이름 — 토스트 문구용.
const sectionName = (s: CycleSectionRef | null) => s?.cycle?.name ?? '백로그';

export function useMoveIssueCycle(projectKey: string) {
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: ({ issue, from, to }: MoveIssueCycleVars) =>
      moveIssueCycle(projectKey, issue.number, from?.cycle?.id ?? null, to?.cycle?.id ?? null),
    onMutate: async ({ issue, from, to }) => {
      // 패치할 구간 — 출발 구간(행 제거)과 도착 "사이클" 구간(행 삽입).
      // 백로그는 즉시 넣지 않는다: 행에는 사이클 집합이 없어, 이슈가 다른 진행 중·예정 사이클에도 속해 있으면 여전히
      // 백로그 밖이다 — 넣었다가 재조회 때 사라지는 깜빡임이 생긴다. 백로그 행은 onSettled 재조회가 서버 기준으로 채운다.
      const insertInto = to?.cycle ? to : null;
      const keys = [from, insertInto].flatMap((r) => (r ? [r.queryKey] : []));
      // 진행 중인 해당 구간 요청이 낙관적 패치를 덮어쓰지 않게 멈춘다.
      await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey, exact: true })));
      const snapshots = keys.map((k) => [k, qc.getQueryData<SearchData>(k)] as const);

      // 출발 구간에서 행 제거.
      if (from) {
        qc.setQueryData<SearchData>(from.queryKey, (old) =>
          old && {
            ...old,
            pages: old.pages.map((p) => ({ ...p, items: (p.items ?? []).filter((it) => it.id !== issue.id) })),
          },
        );
      }
      // 도착 사이클 구간 맨 앞에 삽입 — 중복 방지.
      if (insertInto) {
        qc.setQueryData<SearchData>(insertInto.queryKey, (old) => {
          if (!old || old.pages.length === 0) return old;
          if (old.pages.some((p) => (p.items ?? []).some((it) => it.id === issue.id))) return old;
          const [first, ...rest] = old.pages;
          return { ...old, pages: [{ ...first, items: [issue, ...(first.items ?? [])] }, ...rest] };
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
      // 백로그로 보냈는데 백로그에 나타나지 않는 경우(다른 진행 중·예정 사이클에 남음 / 종료 이슈)는 이유를 알린다.
      let message = `${label} 을(를) ${sectionName(vars.to)}(으)로 옮겼습니다`;
      if (!vars.to?.cycle) {
        const stillPlanned = result.cycles.some((c) => c.status === 'ACTIVE' || c.status === 'PLANNED');
        const reason = stillPlanned
          ? '다른 진행 중·예정 사이클에 남아 있어'
          : vars.to?.hidesClosed && CLOSED_STATUSES.has(vars.issue.status)
            ? '종료된 이슈라'
            : null;
        if (reason) message = `${label} 을(를) ${sectionName(vars.from)}에서 뺐습니다 (${reason} 백로그에는 표시되지 않습니다)`;
      }
      // 역차분 — 붙인 to 만 떼고, 뗀 from 만 다시 붙인다. 실제 변화가 없었으면 되돌리기 없음.
      const undoFrom = result.addedTo ? vars.to : null;
      const undoTo = result.removedFrom ? vars.from : null;
      // 완료 구간 행은 사이클 이동 대상이 아니므로(구간이 cycleSection 을 싣지 않음) 되돌리기는 항상 재연결 가능하다.
      const canUndo = undoFrom != null || undoTo != null;
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
    onSettled: () => {
      // 구간 행(모든 구간 — 한 이슈가 여러 구간에 보일 수 있다)·진행률을 서버 기준으로 재동기화.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
    },
  });
  return move;
}
