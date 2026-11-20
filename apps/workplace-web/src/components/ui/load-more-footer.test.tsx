// LoadMoreFooter 접근성 — 다음 페이지 실패 알림과 다시 시도 중 포커스 유지 (WP-1862).
// 왜: 실패 줄이 live region 없이 그려져 스크린 리더가 목록이 끝난 줄 알았고, 다시 시도를 누르면 버튼이
// 언마운트돼 키보드 포커스가 body 로 떨어졌다. jsdom 이 요소 동일성·activeElement 를 그대로 재므로 vitest 로 지킨다.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LoadMoreFooter } from '@/components/ui/load-more-footer';

const ERROR_LABEL = '불러오지 못했습니다 — 다시 시도';

// 가짜 query — 상태 조합만 바꿔 rerender 한다. fetchNextPage 는 호출 횟수만 본다.
function makeQuery(
  fetchNextPage: () => unknown,
  state: { isFetchNextPageError?: boolean; isFetchingNextPage?: boolean } = {},
) {
  const isFetchingNextPage = state.isFetchingNextPage ?? false;
  return {
    hasNextPage: true,
    isFetching: isFetchingNextPage,
    isFetchNextPageError: state.isFetchNextPageError ?? false,
    isFetchingNextPage,
    fetchNextPage,
  };
}

describe('LoadMoreFooter 접근성', () => {
  it('다음 페이지 실패를 status 영역으로 알리고, 자동 로드 중에는 비워 둔다', () => {
    const fetchNextPage = vi.fn();
    // 실패 전부터 빈 live region 이 붙어 있다가 같은 요소에 문구가 채워져야 스크린 리더가 읽는다.
    const { rerender } = render(<LoadMoreFooter enabled={false} query={makeQuery(fetchNextPage)} />);
    const live = screen.getByRole('status');
    expect(live).toBeEmptyDOMElement();
    rerender(<LoadMoreFooter enabled={false} query={makeQuery(fetchNextPage, { isFetchNextPageError: true })} />);
    expect(screen.getByRole('status')).toBe(live);
    expect(live).toHaveTextContent(ERROR_LABEL);

    // 자동 로드 중(실패 아님) — 화면엔 보이되 스크린 리더에는 알리지 않는다
    rerender(<LoadMoreFooter enabled={false} query={makeQuery(fetchNextPage, { isFetchingNextPage: true })} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument();

    // 수동 모드도 실패하면 같은 문구
    rerender(
      <LoadMoreFooter
        enabled={false}
        manualLabel="더 보기"
        query={makeQuery(fetchNextPage, { isFetchNextPageError: true })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(ERROR_LABEL);
  });

  it('다음 페이지가 없을 때도 빈 live region 을 두어, 실패와 함께 푸터가 나타나도 같은 요소로 알린다', () => {
    const fetchNextPage = vi.fn();
    // 캘린더 일정 목록처럼 실패한 순간에 hasNextPage 가 켜지는 어댑터 — 이미 채워진 채 새로 붙는 live region 은 읽히지 않는다.
    const { rerender } = render(
      <LoadMoreFooter enabled={false} query={{ ...makeQuery(fetchNextPage), hasNextPage: false }} />,
    );
    const live = screen.getByRole('status');
    expect(live).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<LoadMoreFooter enabled={false} query={makeQuery(fetchNextPage, { isFetchNextPageError: true })} />);
    expect(screen.getByRole('status')).toBe(live);
    expect(live).toHaveTextContent(ERROR_LABEL);
  });

  it('다시 시도를 누르면 불러오는 동안·다시 실패한 뒤에도 같은 버튼에 포커스가 남는다', async () => {
    const user = userEvent.setup();
    const fetchNextPage = vi.fn();
    const { rerender } = render(
      <LoadMoreFooter enabled={false} query={makeQuery(fetchNextPage, { isFetchNextPageError: true })} />,
    );
    const button = screen.getByRole('button', { name: ERROR_LABEL });
    await user.click(button);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    // v5 는 다시 시도 중에도 isError 가 유지돼 실패·불러오는 중이 함께 true
    rerender(
      <LoadMoreFooter
        enabled={false}
        query={makeQuery(fetchNextPage, { isFetchNextPageError: true, isFetchingNextPage: true })}
      />,
    );
    const loading = screen.getByRole('button', { name: '불러오는 중…' });
    expect(loading).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    // 다시 실패
    rerender(
      <LoadMoreFooter
        enabled={false}
        query={makeQuery(fetchNextPage, { isFetchNextPageError: true, isFetchingNextPage: false })}
      />,
    );
    expect(screen.getByRole('button', { name: ERROR_LABEL })).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('status')).toHaveTextContent(ERROR_LABEL);
  });

  it('다시 시도 중 버튼을 다시 눌러도 요청을 겹치지 않는다', async () => {
    const user = userEvent.setup();
    const fetchNextPage = vi.fn();
    render(
      <LoadMoreFooter
        enabled={false}
        query={makeQuery(fetchNextPage, { isFetchNextPageError: true, isFetchingNextPage: true })}
      />,
    );
    await user.click(screen.getByRole('button', { name: '불러오는 중…' }));
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});
