import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RouteErrorBoundary } from './RouteErrorBoundary';

// 앱 전체 오류 경계가 주소(pathname)가 바뀌면 오류를 푸는지 본다 (WP-2024).

/** 렌더 중 오류를 던져 경계가 오류 화면을 그리게 하는 라우트 화면 */
function Broken(): never {
  throw new Error('깨진 화면');
}

/** 경계 바로 아래에서 마운트될 때 onMount 를 부른다 — 주소 이동에 다시 마운트되는지 센다 */
function MountCounter({ children, onMount }: { children: React.ReactNode; onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <>{children}</>;
}

/** 경계 아래에 라우트를 두고, 경계 밖 라우터(router.navigate)로 이동한다 */
function setup(initial: string, onMount: () => void = () => {}) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <RouteErrorBoundary>
            <MountCounter onMount={onMount}>
              <RouteContent />
            </MountCounter>
          </RouteErrorBoundary>
        ),
      },
    ],
    { initialEntries: [initial] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** 현재 주소에 따라 던지거나 정상 문구를 그린다 */
function RouteContent() {
  const { pathname } = useLocation();
  if (pathname === '/broken') return <Broken />;
  return <p>정상 화면</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RouteErrorBoundary', () => {
  it('오류 화면에서 다른 주소로 가면 새 화면이 보인다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = setup('/broken');
    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();
    await act(() => router.navigate('/ok'));
    expect(await screen.findByText('정상 화면')).toBeInTheDocument();
  });

  it('정상 화면에서 깨진 주소로 가면 오류를 한 번만 잡고 오류 화면에 머문다', async () => {
    // 오류를 잡은 그 커밋에서 이전 주소와 비교해 곧바로 풀면 깨진 화면을 한 번 더 그려 오류가 두 번 잡힌다
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = setup('/a');
    await act(() => router.navigate('/broken'));
    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();
    const caught = errorSpy.mock.calls.filter(([first]) => first === '[PageErrorBoundary]');
    expect(caught).toHaveLength(1);
  });

  it('search 만 바뀌면 오류 화면을 유지한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = setup('/broken');
    await act(() => router.navigate('/broken?x=1'));
    expect(screen.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toBeInTheDocument();
  });

  it('주소가 바뀌어도 경계 아래 자식은 다시 마운트되지 않는다', async () => {
    const onMount = vi.fn();
    const router = setup('/a', onMount);
    await act(() => router.navigate('/b'));
    expect(screen.getByText('정상 화면')).toBeInTheDocument();
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
