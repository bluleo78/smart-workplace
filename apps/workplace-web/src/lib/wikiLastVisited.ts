import { isAxiosError } from 'axios';

// 노트 앱 "마지막으로 본 페이지" 기억 — /wiki 진입 시 직전 페이지를 복원하기 위한 localStorage 영속.
// 새로고침·재로그인 후에도 유지돼야 하므로 localStorage 를 쓰되, 같은 브라우저를 쓰는 다른 계정/테넌트의
// 페이지로 튀지 않도록 키를 사용자·테넌트 단위로 분리한다.
// pageId 만 저장한다 — 소속 스페이스는 복원 시 페이지 조회 응답(page.spaceId)이 권위 있는 값이라
// URL 을 손으로 고친 경우에도 잘못된 spaceId 가 저장·복원되지 않는다.

const KEY_PREFIX = 'wiki.lastVisitedPage:';

/** 사용자·테넌트 스코프 키. 활성 테넌트가 없는 세션도 있으므로 'none' 으로 폴백. */
export function wikiLastVisitedKey(userId: number, tenantId: number | null | undefined): string {
  return `${KEY_PREFIX}${userId}:${tenantId ?? 'none'}`;
}

/** 저장된 pageId 조회. 없거나 손상됐거나 localStorage 접근 불가(사파리 프라이빗 등)면 null. */
export function readWikiLastVisited(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const id = raw == null ? NaN : Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** 마지막으로 본 pageId 기록. 저장 실패는 복원만 안 될 뿐이므로 무시. */
export function writeWikiLastVisited(key: string, pageId: number): void {
  try {
    localStorage.setItem(key, String(pageId));
  } catch {
    // 저장 실패 시 다음 진입은 기본 화면으로
  }
}

/** 삭제·권한 상실로 더는 열 수 없는 페이지 기록 제거. */
export function clearWikiLastVisited(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 제거 실패는 다음 진입에서 다시 404/403 → 재시도되므로 무시
  }
}

/** 404(삭제)·403(권한 상실)만 "다시 열 수 없음"으로 본다 — 5xx·네트워크 오류는 일시적이므로 기록을 유지. */
export function isWikiPageGone(error: unknown): boolean {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  return status === 404 || status === 403;
}
