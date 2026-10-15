// 완료율(%) 공용 규칙 — 사이클 진행 막대·사이클 모바일 행·프로젝트 목록 행이 같은 계산을 쓰도록 한곳에 모았다.

/** 완료율(%) — 전체 0건이면 0(0 나누기 방지), 그 외 반올림. */
export function completionPct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}
