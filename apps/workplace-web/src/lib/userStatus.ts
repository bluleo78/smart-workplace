// 사람의 활성 상태 표기(WP-1080) — 응답의 active 가 명시적으로 false 일 때만 비활성(정지·전역 비활성)으로 보고, 없으면 활성으로 본다.
// 담당자 후보(assigneeCandidates)·담당자 칸·작업 목록·아바타가 같은 판정과 같은 「(비활성)」 꼬리를 쓴다.

/** 비활성 사람인가 — active 가 명시적으로 false 일 때만. */
export function isInactiveUser(u: { active?: boolean }): boolean {
  return u.active === false;
}

/** 비활성이면 이름 뒤에 「(비활성)」을 붙인다. */
export function withInactiveSuffix(name: string, inactive: boolean): string {
  return inactive ? `${name} (비활성)` : name;
}

/** 사람 요약의 표시 이름 — 비활성이면 「이름 (비활성)」. */
export function displayNameWithStatus(u: { name: string; active?: boolean }): string {
  return withInactiveSuffix(u.name, isInactiveUser(u));
}
