import { useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { userScopedKey } from '@/lib/userScopedKey';

import { parseTimelineZoom } from './timelineData';
import type { TimelineZoom } from './timelineTypes';

// 고른 보기 단위는 사용자·워크스페이스별로 기억한다(WP-889) — 일 보기를 쓰는 사람이 열 때마다 주 보기로 돌아가지 않게.
// 프로젝트마다 나누지 않는다: 보기 단위는 사람의 습관이라 프로젝트를 옮겨도 같게 보는 편이 자연스럽다.
const ZOOM_BASE = 'timeline.zoom';

/** 타임라인 보기 단위 — 처음엔 저장해 둔 값(없으면 주), 바꾸면 저장한다. 저장이 막힌 환경에서도 화면 상태는 바뀐다. */
export function useTimelineZoom(): [TimelineZoom, (zoom: TimelineZoom) => void] {
  const { user, activeTenant } = useAuth();
  const key = userScopedKey(ZOOM_BASE, { userId: user?.id ?? 0, tenantId: activeTenant?.tenantId ?? null });
  const [zoom, setZoomState] = useState<TimelineZoom>(() => {
    try {
      return parseTimelineZoom(localStorage.getItem(key));
    } catch {
      return 'week';
    }
  });
  const setZoom = (next: TimelineZoom) => {
    setZoomState(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // 저장 불가(프라이빗 모드 등) — 이번 화면에서만 유지.
    }
  };
  return [zoom, setZoom];
}
