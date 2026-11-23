import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('청크 실패로 새로고침할 때 새로고침 표시를 sessionStorage 에 남긴다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockReload();
    render(
      <PageErrorBoundary>
        <Thrower error={new TypeError('Failed to fetch dynamically imported module: http://x/a.js')} shouldThrow={{ current: true }} />
      </PageErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toContain('http://x/a.js');
  });

  it('새로고침 직후 같은 청크가 또 실패하면 새로고침으로 낫지 않는다는 다른 안내를 보이고 표시를 지운다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new TypeError('Failed to fetch dynamically imported module: http://x/a.js');
    markChunkReload(error);
    render(
      <PageErrorBoundary>
        <Thrower error={error} shouldThrow={{ current: true }} />
      </PageErrorBoundary>,
    );
    expect(screen.getByText(/새로고침해도 화면 파일을 받지 못했습니다/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('새로고침 뒤 다른 오류가 나면 처음 안내를 보이고 표시는 남긴다(진짜 되풀이를 놓치지 않게)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    markChunkReload(new TypeError('Failed to fetch dynamically imported module: http://x/a.js'));
    render(
      <PageErrorBoundary>
        <Thrower error={new Error('렌더 오류')} shouldThrow={{ current: true }} />
      </PageErrorBoundary>,
    );
    expect(screen.getByText(/일시적인 오류가 발생했습니다/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
  });
});
