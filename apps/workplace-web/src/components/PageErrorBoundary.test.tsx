import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
      <MemoryRouter initialEntries={['/broken']}>
        <PageErrorBoundary>
          <Thrower error={new TypeError('Failed to fetch dynamically imported module: http://x/a.js')} shouldThrow={shouldThrow} />
        </PageErrorBoundary>
      </MemoryRouter>,
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
      <MemoryRouter initialEntries={['/broken']}>
        <PageErrorBoundary>
          <Thrower error={new Error('렌더 오류')} shouldThrow={shouldThrow} />
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    shouldThrow.current = false;

    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText('페이지 내용')).toBeInTheDocument();
  });
});

describe('PageErrorBoundary 홈으로', () => {
  /** 주소가 깨진 곳(/broken)에서는 오류를 던지고, 그 밖의 주소에서는 홈 화면을 그린다. */
  function Screen() {
    const { pathname } = useLocation();
    if (pathname === '/broken') throw new Error('렌더 오류');
    return (
      <Routes>
        <Route path="/" element={<p>홈 화면</p>} />
        <Route path="*" element={<p>다른 화면</p>} />
      </Routes>
    );
  }

  /** 청크 로드 실패도 같은 모양 — /broken 에서만 던지고 주소가 바뀌면 그린다. */
  function ChunkThrower() {
    const { pathname } = useLocation();
    if (pathname === '/broken') {
      throw new TypeError('Failed to fetch dynamically imported module: http://x/a.js');
    }
    return <p>홈 화면</p>;
  }

  /**
   * 홈 주소(/)에 있을 때만 오류를 던진다 — pathname 무관하게 던지는 자식은
   * 「홈으로」를 안 눌러도 오류 화면이 되돌아와 「홈으로 간 뒤」를 검사하지 못한다.
   */
  function HomeThrower() {
    const { pathname } = useLocation();
    if (pathname === '/') throw new Error('렌더 오류');
    return <p>페이지 내용</p>;
  }

  it('오류 화면에서 「홈으로」를 누르면 홈 화면이 보인다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <PageErrorBoundary>
          <Screen />
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '홈으로' }));

    expect(await screen.findByText('홈 화면')).toBeInTheDocument();
    expect(screen.queryByText('페이지를 불러오는 중 문제가 발생했습니다')).not.toBeInTheDocument();
  });

  it('청크 로드 실패 화면에서도 「홈으로」는 새로고침하지 않고 주소만 바꾼다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = mockReload();
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <PageErrorBoundary>
          <ChunkThrower />
        </PageErrorBoundary>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: '홈으로' }));

    expect(reload).not.toHaveBeenCalled();
    expect(await screen.findByText('홈 화면')).toBeInTheDocument();
  });

  it('홈으로 간 뒤 자식이 다시 던지면 오류 화면을 다시 그린다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // 깨진 주소(/broken)에서 오류 화면을 먼저 만든다 — 「홈으로」를 누를 자리가 필요하다.
    const { rerender } = render(
      <MemoryRouter initialEntries={['/broken']}>
        <PageErrorBoundary>
          <Screen />
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    // 자식을 홈에서만 오류 내는 것으로 갈아낀다 — 홈으로 가지 않으면 오류가 되풀이되지 않아 오류 화면이 사라진다.
    rerender(
      <MemoryRouter initialEntries={['/broken']}>
        <PageErrorBoundary>
          <HomeThrower />
        </PageErrorBoundary>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: '홈으로' }));

    expect(await screen.findByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '홈으로' })).toBeInTheDocument();
  });
});
