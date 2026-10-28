// 이슈 상세 캐시 낙관적 패치(WP-1079) — 속성 레일의 칩 줄(구성요소·버전)이 저장 응답·재조회를 기다리지 않고 바로 바뀌게 한다.
// 저장 중 고르기 트리거를 disabled 로 잠그면 팝오버를 닫을 때 돌아온 포커스를 잃고(잠긴 버튼은 포커스를 놓는다), 잠그지 않으면
// 재조회 전까지 칩·고르기가 옛 값을 보였다. 캐시를 먼저 고치면 둘 다 새 값을 보고, 트리거를 잠글 필요가 없다.
import type { QueryClient } from '@tanstack/react-query';

import type { IssueDetailResponse, IssueResponse } from '../../types/issue';
import { issueKeys } from './useIssues';

/**
 * 상세 캐시의 summary 를 patch 로 덮는다 — 진행 중 재조회가 패치를 옛 값으로 덮지 않게 먼저 취소한다.
 * 돌려준 restore() 는 실패 시 패치 전 캐시로 되돌린다. 캐시가 없으면(상세를 안 연 상태) 아무것도 하지 않는다.
 */
export async function patchIssueDetailSummary(
  qc: QueryClient,
  projectKey: string,
  number: number,
  patch: (summary: IssueResponse) => Partial<IssueResponse>,
): Promise<{ restore: () => void }> {
  const key = issueKeys.detail(projectKey, number);
  await qc.cancelQueries({ queryKey: key });
  const snapshot = qc.getQueryData<IssueDetailResponse>(key);
  if (snapshot) qc.setQueryData<IssueDetailResponse>(key, { ...snapshot, summary: { ...snapshot.summary, ...patch(snapshot.summary) } });
  return { restore: () => qc.setQueryData(key, snapshot) };
}

/**
 * 고른 id 목록 → 칩에 쓸 요약 목록(고른 순서). 이름·상태는 프로젝트 목록 캐시(all)에서, 없으면 이슈에 이미 붙은 값(current)에서 찾는다.
 * 둘 다 없는 id 는 뺀다 — 재조회가 서버 값으로 채운다.
 */
export function summariesFor<T extends { id: number }>(ids: number[], all: readonly T[] | undefined, current: readonly T[] | undefined): T[] {
  const byId = new Map<number, T>([...(current ?? []), ...(all ?? [])].map((x) => [x.id, x]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
