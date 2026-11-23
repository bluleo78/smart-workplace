import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHUNK_RELOAD_KEY, markChunkReload } from '@/lib/chunkLoadError';

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
  window.sessionStorage.clear();
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

  it('청크 실패로 새로고침할 때 새로고침 표시를 sessionStorage 에 남긴다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockReload();
    render(
      <MemoryRouter>
        <PageErrorBoundary>
          <Thrower error={new TypeError('Failed to fetch dynamically imported module: http://x/a.js')} shouldThrow={{ current: true }} />
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toContain('http://x/a.js');
  });

  it('새로고침 직후 같은 청크가 또 실패하면 새로고침으로 낫지 않는다는 다른 안내를 보이고 표시를 지운다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new TypeError('Failed to fetch dynamically imported module: http://x/a.js');
    markChunkReload(error);
    render(
      <MemoryRouter>
        <PageErrorBoundary>
          <Thrower error={error} shouldThrow={{ current: true }} />
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText(/새로고침해도 화면 파일을 받지 못했습니다/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('새로고침 뒤 다른 오류가 나면 처음 안내를 보이고 표시는 남긴다(진짜 되풀이를 놓치지 않게)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    markChunkReload(new TypeError('Failed to fetch dynamically imported module: http://x/a.js'));
    render(
      <MemoryRouter>
        <PageErrorBoundary>
          <Thrower error={new Error('렌더 오류')} shouldThrow={{ current: true }} />
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText(/일시적인 오류가 발생했습니다/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
  });
});

describe('PageErrorBoundary resetKey', () => {
  /** resetKey 를 바꿔 다시 그릴 수 있게 경계를 만든다. */
  function ui(resetKey: string, shouldThrow: { current: boolean }, onRender?: () => void) {
    // 폴백의 「홈으로」가 useNavigate 를 쓰므로 Router 안에서 그린다(WP-2028).
    return (
      <MemoryRouter>
        <PageErrorBoundary resetKey={resetKey}>
          <Thrower error={new Error('렌더 오류')} shouldThrow={shouldThrow} />
          {onRender ? <Counter onRender={onRender} /> : null}
        </PageErrorBoundary>
      </MemoryRouter>
    );
  }

  /** 렌더될 때마다 콜백을 불러 렌더 횟수를 센다. */
  function Counter({ onRender }: { onRender: () => void }) {
    onRender();
    return null;
  }

  it('오류 중 resetKey 가 바뀌면 오류를 풀고 자식을 다시 그린다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const shouldThrow = { current: true };
    const { rerender } = render(ui('/a', shouldThrow));
    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();

    shouldThrow.current = false;
    rerender(ui('/b', shouldThrow));

    expect(screen.getByText('페이지 내용')).toBeInTheDocument();
  });

  it('resetKey 가 바뀐 뒤에도 자식이 던지면 다시 오류 화면', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const shouldThrow = { current: true };
    const { rerender } = render(ui('/a', shouldThrow));

    rerender(ui('/b', shouldThrow));

    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();
  });

  it('오류가 없을 때 resetKey 가 바뀌어도 자식은 그대로', () => {
    const shouldThrow = { current: false };
    const onRender = vi.fn();
    const { rerender } = render(ui('/a', shouldThrow, onRender));
    expect(onRender).toHaveBeenCalledTimes(1);

    rerender(ui('/b', shouldThrow, onRender));

    expect(screen.getByText('페이지 내용')).toBeInTheDocument();
    expect(screen.queryByText('페이지를 불러오는 중 문제가 발생했습니다')).not.toBeInTheDocument();
    // 상태를 되돌리지 않으므로 부모가 다시 그린 한 번 외에 추가 렌더가 없다
    expect(onRender).toHaveBeenCalledTimes(2);
  });

  it('resetKey 가 같으면 오류 화면 유지', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const shouldThrow = { current: true };
    const { rerender } = render(ui('/a', shouldThrow));

    shouldThrow.current = false;
    rerender(ui('/a', shouldThrow));

    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();
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
