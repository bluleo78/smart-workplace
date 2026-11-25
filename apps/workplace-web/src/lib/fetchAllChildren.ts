// 이슈의 하위를 열린·끝난 두 갈래 모두, nextCursor 가 끝날 때까지 받아 한 배열로 잇는다(WP-2098).
// 왜: 에픽으로 바꾸기 전 「유형을 함께 바꿀 하위 태스크」 전체(완료된 것 포함)를 확인 창에 보이려면 화면에 펼쳐진 페이지만으로는 모자란다.
// 읽을 수 없는 프로젝트의 하위는 서버가 싣지 않는다(hiddenCount) — 서버가 변환 때 다시 판정하므로 여기선 보이는 것만 센다.

import { issuesApi } from '../api/issues';
import type { ChildrenState, IssueResponse } from '../types/issue';

/** 하위 목록 한 페이지 크기 — 하위 섹션(IssueChildrenSection)과 이 전체 조회가 같이 쓴다. */
export const CHILDREN_PAGE_SIZE = 100;

async function fetchState(key: string, number: number, state: ChildrenState): Promise<IssueResponse[]> {
  const all: IssueResponse[] = [];
  let cursor: string | null = null;
  // 커서가 없어질 때까지 반복 — 응답에 nextCursor 가 없으면 한 페이지로 끝낸다.
  do {
    const page = await issuesApi.children(key, number, { state, cursor, size: CHILDREN_PAGE_SIZE });
    all.push(...(page?.items ?? []));
    cursor = page?.nextCursor ?? null;
  } while (cursor);
  return all;
}

/** 열린 하위 다음 끝난 하위 순으로 모두 받는다. 어느 요청이든 실패하면 거부된다. */
export async function fetchAllChildren(key: string, number: number): Promise<IssueResponse[]> {
  const open = await fetchState(key, number, 'open');
  const closed = await fetchState(key, number, 'closed');
  return [...open, ...closed];
}
