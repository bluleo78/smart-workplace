import { wikiLastSpaceKey, wikiLastVisitedKey } from '../lib/wikiLastVisited';
import { useAuth } from './useAuth';

/** 현재 로그인 사용자·활성 테넌트 기준 "마지막 본 노트" 키. 사용자 미로딩 시 null(기록·복원 생략). */
export function useWikiLastVisitedKey(): string | null {
  const { user, activeTenant } = useAuth();
  return user ? wikiLastVisitedKey(user.id, activeTenant?.tenantId) : null;
}

/** 같은 스코프의 "마지막으로 고른 공간" 키(WP-180). 사용자 미로딩 시 null. */
export function useWikiLastSpaceKey(): string | null {
  const { user, activeTenant } = useAuth();
  return user ? wikiLastSpaceKey(user.id, activeTenant?.tenantId) : null;
}
