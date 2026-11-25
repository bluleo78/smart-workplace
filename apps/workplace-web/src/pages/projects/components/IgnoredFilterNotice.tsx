// WP-2083 — 이슈 목록 주소에 알 수 없는 필터 값이 있으면 목록 위에 알린다.
// 화면은 모르는 토큰을 조용히 버려 「필터가 걸린 줄 알았는데 전체 목록」이 되므로, 무엇이 적용되지 않았는지 보이고 주소에서 뺄 수 있게 한다.
import { TriangleAlert } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { ignoredFilterTokens, withoutIgnoredFilterTokens } from '../../../lib/ignoredFilterTokens';
import { withIgnoredCleared } from '../hooks/useRememberedIssueQuery';

/**
 * 알 수 없는 필터 값 안내 한 줄. 주소(useSearchParams)를 직접 읽는다. 알림(role=status) 영역은 늘 그려 두고 안의 글만 채워야
 * 화면 낭독기가 나중에 생긴 안내를 알린다(IssueResultStatus 와 같은 패턴) — 알 수 없는 값이 없으면 보이는 것은 없다.
 * 「주소에서 지우기」는 그 토큰만 뺀 주소로 replace 이동한다 — 조건 기억이 지워지지 않게 표지 state 를 단다(useRememberedIssueQuery).
 */
export function IgnoredFilterNotice() {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const ignored = ignoredFilterTokens(params);
  const list = ignored.map((t) => `${t.label} ${t.value}`).join(', ');

  // 기존 location.state(개요 링크 표지 등)는 살리고 표지만 합친다. 주소는 눌렀을 때의 최신 값(prev)으로 계산한다.
  const clear = () =>
    setParams((prev) => withoutIgnoredFilterTokens(prev), {
      replace: true,
      state: withIgnoredCleared(state),
    });

  return (
    <div role="status" aria-live="polite" data-testid="ignored-filter-notice-region">
      {ignored.length > 0 && (
        <div
          data-testid="ignored-filter-notice"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warning-text"
        >
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span>주소의 필터 값을 알 수 없어 적용하지 않았습니다: {list}</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            data-testid="ignored-filter-clear"
            onClick={clear}
          >
            주소에서 지우기
          </Button>
        </div>
      )}
    </div>
  );
}
