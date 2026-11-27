/**
 * 거절한 일정 제목 표시 테스트 (WP-2149).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeclinedTitle } from './declinedEvent';

describe('DeclinedTitle', () => {
  it('거절이면 「거절」 배지를 제목 앞에 두고 제목에만 취소선을 긋는다', () => {
    render(<DeclinedTitle declined>회의</DeclinedTitle>);
    const badge = screen.getByTestId('calendar-event-declined-badge');
    const title = screen.getByText('회의');
    expect(badge).toHaveTextContent('거절');
    expect(badge).not.toHaveClass('line-through');
    expect(title).toHaveClass('line-through');
    expect(badge.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('거절이 아니면 배지·취소선 없이 제목만 낸다', () => {
    const { container } = render(<DeclinedTitle declined={false}>회의</DeclinedTitle>);
    expect(screen.queryByTestId('calendar-event-declined-badge')).toBeNull();
    expect(container.querySelector('.line-through')).toBeNull();
    expect(container).toHaveTextContent('회의');
  });

  it('스크린리더 이름이 제목과 띄어 읽힌다 (거절, 회의)', () => {
    render(
      <button>
        <DeclinedTitle declined>회의</DeclinedTitle>
      </button>,
    );
    // jsdom 은 이름 계산에서 쉼표 앞에 공백을 하나 더 넣는다 — 실제 브라우저는 "거절, 회의".
    expect(screen.getByRole('button', { name: /^거절\s*,\s*회의$/ })).toBeInTheDocument();
  });
});
