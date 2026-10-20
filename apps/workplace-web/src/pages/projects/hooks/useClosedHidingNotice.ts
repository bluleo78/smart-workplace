// 종료 이슈 숨김 안내 설정(WP-606) — 숨김이 켜진 화면에서만 값을 주고, 「모두 보기」는 URL 에 closed=all 을 더한다
// (필터 바의 「완료 모두 보기」 토글과 같은 상태 — 다른 파라미터·모바일 보드 탭은 그대로 둔다).
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { ClosedHidingNotice } from '../../../lib/closedHiding';
import type { CycleStatus } from '../../../types/cycle';

const ACTIVE_ONLY: readonly CycleStatus[] = ['ACTIVE'];

export function useClosedHidingNotice(
  enabled: boolean,
  visibleCycleStatuses: readonly CycleStatus[] = ACTIVE_ONLY,
): ClosedHidingNotice | undefined {
  const [, setParams] = useSearchParams();
  return useMemo(
    () =>
      enabled
        ? {
            visibleCycleStatuses,
            onShowAll: () =>
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('closed', 'all');
                  return next;
                },
                { replace: true },
              ),
          }
        : undefined,
    [enabled, visibleCycleStatuses, setParams],
  );
}
