import { wikiLastSpaceKey, wikiLastVisitedKey } from '../lib/wikiLastVisited';
import { useAuth } from './useAuth';

/** 현재 로그인 사용자·활성 테넌트 기준 스코프 키. 사용자 미로딩 시 null(기록·복원 생략). */
function useWikiScopedKey(build: (userId: number, tenantId: number | null | undefined) => string): string | null {
  const { user, activeTenant } = useAuth();
  return user ? build(user.id, activeTenant?.tenantId) : null;
}

/** "마지막 본 노트(페이지)" 키. */
export function useWikiLastVisitedKey(): string | null {
  return useWikiScopedKey(wikiLastVisitedKey);
}

/** "마지막으로 고른 공간" 키(WP-180). */
export function useWikiLastSpaceKey(): string | null {
  return useWikiScopedKey(wikiLastSpaceKey);
}
