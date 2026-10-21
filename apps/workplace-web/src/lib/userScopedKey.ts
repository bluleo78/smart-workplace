// 같은 브라우저를 쓰는 다른 사용자·워크스페이스와 섞이면 안 되는 사용자 설정(localStorage)의 키(WP-701).
// 예전엔 즐겨찾기·캘린더 표시 설정이 브라우저 하나에 키 하나라, 로그아웃 뒤 같은 브라우저로 들어온 다음 사용자에게 그대로 보였다.
// 예전 브라우저 단위 키의 값은 누구 것인지 알 수 없어 옮기지 않는다(새 키에서 처음부터 다시 고른다).

/** 설정 주인 — 로그인 사용자 id 와 지금 워크스페이스 id(없으면 null). */
export interface StorageOwner {
  userId: number;
  tenantId: number | null;
}

/** 주인별 키 — `<base>:<userId>:<tenantId|->`. */
export function userScopedKey(base: string, owner: StorageOwner): string {
  return `${base}:${owner.userId}:${owner.tenantId ?? '-'}`;
}
