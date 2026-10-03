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
