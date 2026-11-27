/**
 * 거절한 일정의 제목 표시 (WP-2149).
 *
 * 시간 그리드(종일 칩·시간 블록)·월 보기 칩·목록 보기(데스크톱·모바일)가 같은 규칙을 쓰도록
 * 「배지 + 취소선 제목」을 한 컴포넌트로 묶는다. 흐림은 행·칩 쪽 클래스라 각 보기가 붙인다.
 */
import type { ReactNode } from 'react';

import { RSVP_LABEL } from '@/lib/calendarEventView';

/**
 * 일정 칩의 제목. 거절했으면 제목 앞에 「거절」 배지를 두고 제목 글자에만 취소선을 긋는다.
 * - 배지를 앞에 두는 것은 한 줄 잘림(truncate) 칩에서도 배지가 잘리지 않게 하려는 것.
 * - 취소선은 형제인 제목 span 에만 걸어 배지·태그 점에는 닿지 않는다.
 * - 배지 배경: `chip`(기본)은 반투명 검정 — 칩이 라이트·다크 모두 채도 높은 *-600/700 배경에 흰 글자라 한 가지로 충분하다.
 *   `plain` 은 색 없는 목록 행 위라 시맨틱 토큰(bg-muted)을 쓴다 — 검정 반투명은 다크 배경에서 보이지 않는다.
 * - 라벨 뒤 sr-only 쉼표로 스크린리더가 제목과 띄어 읽는다("거절, 10:00 회의").
 * 거절이 아니면 제목을 감싸지 않고 그대로 낸다.
 */
export function DeclinedTitle({
  declined,
  variant = 'chip',
  children,
}: {
  declined: boolean;
  variant?: 'chip' | 'plain';
  children: ReactNode;
}) {
  if (!declined) return <>{children}</>;
  return (
    <>
      <span
        data-testid="calendar-event-declined-badge"
        className={`rounded px-1 mr-1 text-xs font-medium ${variant === 'plain' ? 'bg-muted text-foreground' : 'bg-black/20'}`}
      >
        {RSVP_LABEL.DECLINED}
        <span className="sr-only">, </span>
      </span>
      <span className="line-through">{children}</span>
    </>
  );
}
