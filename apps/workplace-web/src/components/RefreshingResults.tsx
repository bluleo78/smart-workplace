// 조건을 바꾼 뒤 새 결과를 받는 동안의 표시(WP-1049) — 이전 결과를 흐리게 그대로 두고 위에 얇은 진행 막대를 돌린다.
// 왜: 저장한 뷰·필터를 바꿀 때 이전 목록 → 스켈레톤 → 새 목록으로 화면이 세 번 바뀌어 중간 상태가 비쳤다.
//     이전 결과를 자리채움(placeholderData)으로 두고 새 결과가 오면 한 번에 바꾼다 — 레이아웃이 흔들리지 않는다.
// 흐린 동안은 입력을 막는다(inert) — 옛 행을 눌러 열거나 고르면 지금 조건과 다른 이슈를 다루게 된다.
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function RefreshingResults({
  refreshing,
  className,
  children,
}: {
  /** 이전 조건의 결과를 자리채움으로 보이는 중인가(쿼리의 isPlaceholderData). */
  refreshing: boolean;
  /** 바깥 상자 클래스 — 높이를 받는 부모 안이면 h-full 을 준다(안쪽 상자도 h-full 로 이어 받는다). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('relative', className)} aria-busy={refreshing || undefined}>
      {refreshing && (
        <span
          role="progressbar"
          aria-label="새 조건으로 불러오는 중"
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/15"
          data-testid="results-refreshing"
        >
          {/* 문서 변환·메일 첨부와 같은 불확정 막대(animate-convert-indeterminate) — 움직임 줄이기 설정이면 멈춰 둔다. */}
          <span className="block h-full animate-convert-indeterminate bg-primary motion-reduce:animate-none" />
        </span>
      )}
      <div inert={refreshing} className={cn('h-full transition-opacity', refreshing && 'opacity-50')}>
        {children}
      </div>
    </div>
  );
}
