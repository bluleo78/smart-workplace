// 에픽 필터 범위 계산 — 에픽 패널(데스크톱)·에픽 바텀시트(모바일)·향후 진입점이 같은 규칙을 쓰도록 순수 함수로 뺐다.
// 세 선택지(전체·에픽 미할당·특정 에픽)는 URL 의 parent/topLevel 두 값 조합이며 서로 배타다.
// invalidate: 캐시된 같은 queryKey 로 되돌아가는 전환(해제)일 때만 true — 새 필터는 queryKey 가 새로 생겨 재조회가 필요 없다.

export type EpicScopeChoice = { kind: 'all' } | { kind: 'unassigned' } | { kind: 'epic'; number: number };
export type EpicScopeState = { parentNumber: number | null; topLevel: boolean };

/** 현재 URL 필터가 어느 선택지인지. */
export function currentEpicChoice(s: EpicScopeState): EpicScopeChoice {
  if (s.parentNumber != null) return { kind: 'epic', number: s.parentNumber };
  return s.topLevel ? { kind: 'unassigned' } : { kind: 'all' };
}

/** 선택지를 눌렀을 때의 다음 범위. 같은 에픽·미할당 재선택은 토글(전체로 복귀). */
export function nextEpicScope(cur: EpicScopeState, choice: EpicScopeChoice): EpicScopeState & { invalidate: boolean } {
  if (choice.kind === 'all') return { parentNumber: null, topLevel: false, invalidate: true };
  if (choice.kind === 'unassigned') {
    const active = cur.parentNumber == null && cur.topLevel;
    return { parentNumber: null, topLevel: !active, invalidate: active };
  }
  const next = cur.parentNumber === choice.number ? null : choice.number;
  return { parentNumber: next, topLevel: false, invalidate: next === null };
}

/**
 * 에픽 선택 전환 뒤의 「완료 모두 보기」(WP-390). 진행 중 에픽은 사용자 토글을 그대로 따른다.
 * - 종료된 에픽(완료·취소되고 진행 중 사이클 밖 — 「종료된 에픽」 구역)으로 들어가면 켠다: 하위 이슈가 대부분 지난 사이클
 *   완료분이라 기본 숨김이면 목록이 비어 보이기 때문.
 * - 그 종료된 에픽에서 벗어나면(전체·미할당·다른 에픽·같은 에픽 재선택 해제) 끈다 — 남겨 두면 백로그에 지난 완료분이 다시 쌓인다.
 * 종료된 에픽인지는 isClosedEpic(「종료된 에픽」 목록 포함 여부)로 본다.
 */
export function nextShowAllClosed(
  cur: { parentNumber: number | null; showAllClosed: boolean },
  nextParentNumber: number | null,
  isClosedEpic: (epicNumber: number) => boolean,
): boolean {
  if (nextParentNumber != null && isClosedEpic(nextParentNumber)) return true;
  if (cur.parentNumber != null && isClosedEpic(cur.parentNumber)) return false;
  return cur.showAllClosed;
}
