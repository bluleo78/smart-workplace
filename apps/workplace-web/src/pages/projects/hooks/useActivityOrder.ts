import { useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { type ActivityOrder, DEFAULT_ACTIVITY_ORDER, parseActivityOrder } from '@/lib/activityOrder';
import { userScopedKey } from '@/lib/userScopedKey';

// 고른 활동 정렬은 이슈마다가 아니라 앱 전체 설정으로, 사용자·워크스페이스별로 이 브라우저에 기억한다(WP-1016).
// 같은 브라우저를 쓰는 다른 사람에게 섞이지 않게 userScopedKey 를 쓴다(useTimelineZoom 과 같은 방식).
const ORDER_BASE = 'issue.activityOrder';

/** 이슈 활동 정렬 — 처음엔 저장해 둔 값(없으면 오래된 순), 바꾸면 저장한다. 저장이 막힌 환경에서도 화면 상태는 바뀐다. */
export function useActivityOrder(): [ActivityOrder, (order: ActivityOrder) => void] {
  const { user, activeTenant } = useAuth();
  const key = userScopedKey(ORDER_BASE, { userId: user?.id ?? 0, tenantId: activeTenant?.tenantId ?? null });
  const [order, setOrderState] = useState<ActivityOrder>(() => {
    try {
      return parseActivityOrder(localStorage.getItem(key));
    } catch {
      return DEFAULT_ACTIVITY_ORDER;
    }
  });
  const setOrder = (next: ActivityOrder) => {
    setOrderState(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // 저장 불가(프라이빗 모드 등) — 이번 화면에서만 유지.
    }
  };
  return [order, setOrder];
}
