// 아바타 목록 TanStack Query 키(WP-1222) — api 를 끌어오지 않는 순수 키 파일. resource.changed 무효화 규칙(WP-1226)도 여기서 가져간다.

export const avatarKeys = {
  /** 아바타가 바뀌면(내 것·AI 것·다른 사람의 것 — resource.changed 「avatar」) 이 키를 무효화한다. */
  all: ['avatars'] as const,
}
