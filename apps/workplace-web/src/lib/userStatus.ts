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

/** 「이름 +N」·「이름 외 N」 요약의 조각 — 화면마다 잇는 방식(칩의 따로 줄이는 span, 목록의 한 줄 글)이 달라 조각으로 준다. */
export interface PeopleSummary {
  /** 첫 사람 — 정지면 「이름 (비활성)」. 사람이 없으면 null. */
  first: string | null;
  /** 첫 사람 밖의 수(+N·외 N 의 N). */
  others: number;
  /**
   * 「+N」·「외 N」에 묶인 사람 중 정지된 사람 표기(WP-1100) — 첫 사람은 이름 꼬리로 보이지만 묶인 사람은 보이지 않아 「(비활성 n)」으로 붙인다.
   * 없으면 null.
   */
  othersInactive: string | null;
}

/** 사람 목록(담당자 등) → 요약 조각(WP-1160 — 버전 상세·모바일 칩이 같은 조립을 따로 하고 앞 공백을 trim 으로 떼던 것을 모음). */
export function peopleSummary(users: readonly { name: string; active?: boolean }[]): PeopleSummary {
  const n = users.slice(1).filter(isInactiveUser).length;
  return {
    first: users[0] ? displayNameWithStatus(users[0]) : null,
    others: Math.max(users.length - 1, 0),
    othersInactive: n > 0 ? `(비활성 ${n})` : null,
  };
}

/** 사람 요약의 표시 이름 — 비활성이면 「이름 (비활성)」. */
export function displayNameWithStatus(u: { name: string; active?: boolean }): string {
  return withInactiveSuffix(u.name, isInactiveUser(u));
}
