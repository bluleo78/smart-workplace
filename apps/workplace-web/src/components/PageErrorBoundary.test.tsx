import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageErrorBoundary } from './PageErrorBoundary';

// 「다시 시도」 동작(WP-2021) — 청크 로드 실패는 같은 문서에서 다시 그려도 낫지 않아 새로고침하고, 그 밖의 오류는 다시 그린다.

/** 첫 렌더에 주어진 오류를 던지고, shouldThrow.current 가 false 가 되면 정상 내용을 그린다. */
function Thrower({ error, shouldThrow }: { error: Error; shouldThrow: { current: boolean } }) {
  if (shouldThrow.current) throw error;
  return <p>페이지 내용</p>;
}

const originalLocation = window.location;

/** window.location.reload 를 가짜로 바꿔 불렸는지 본다(jsdom 의 reload 는 바꿀 수 없어 location 을 통째로 바꾼다). */
function mockReload() {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
  return reload;
}

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.restoreAllMocks();
});

describe('PageErrorBoundary 다시 시도', () => {
  it('청크 로드 실패면 다시 그리지 않고 페이지를 새로고침한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = mockReload();
    const shouldThrow = { current: true };
    render(
      <PageErrorBoundary>
        <Thrower error={new TypeError('Failed to fetch dynamically imported module: http://x/a.js')} shouldThrow={shouldThrow} />
      </PageErrorBoundary>,
    );
    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(reload).toHaveBeenCalledTimes(1);
    // 새로고침을 기다리는 동안 오류 화면은 그대로다(같은 실패를 다시 던지지 않게 다시 그리지 않는다)
    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();
  });

  it('그 밖의 오류면 새로고침하지 않고 오류 상태를 풀어 다시 그린다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = mockReload();
    const shouldThrow = { current: true };
    render(
      <PageErrorBoundary>
        <Thrower error={new Error('렌더 오류')} shouldThrow={shouldThrow} />
      </PageErrorBoundary>,
    );
    shouldThrow.current = false;

    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText('페이지 내용')).toBeInTheDocument();
  });
});
