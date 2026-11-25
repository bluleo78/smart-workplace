// IgnoredFilterNotice(WP-2083) — 주소의 알 수 없는 필터 값을 알리고, 그 값만 주소에서 지운다.
import { screen } from '@testing-library/react';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/test/renderScreen';

import { IgnoredFilterNotice } from './IgnoredFilterNotice';

// 개요 링크처럼 기존 location.state 를 단 채 진입한 상태를 만든다(같은 주소로 한 번 replace).
function SeedState() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  useEffect(() => {
    navigate(pathname + search, { replace: true, state: { fromOverview: true } });
    // 처음 한 번만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe('IgnoredFilterNotice', () => {
  it('알 수 없는 값을 라벨과 함께 알린다', () => {
    renderScreen(<IgnoredFilterNotice />, { path: '/projects/WP?status=BOGUS&priority=HIGH,NOPE' });
    expect(screen.getByRole('status').textContent).toContain(
      '주소의 필터 값을 알 수 없어 적용하지 않았습니다: 상태 범주 BOGUS, 우선순위 NOPE',
    );
  });

  it('「주소에서 지우기」는 그 값만 빼고 다른 쿼리는 남기며, 기억을 지키는 표지를 단다', async () => {
    const { user, location } = renderScreen(<IgnoredFilterNotice />, {
      path: '/projects/WP?status=BOGUS&priority=HIGH,NOPE&view=board',
    });
    await user.click(screen.getByTestId('ignored-filter-clear'));
    expect(new URLSearchParams(location().split('?')[1]).toString()).toBe('priority=HIGH&view=board');
    expect(screen.queryByTestId('ignored-filter-notice')).toBeNull();
    expect(window.history.state?.usr).toEqual({ ignoredCleared: true });
  });

  it('지우기 이동은 기존 location.state 에 표지를 합친다', async () => {
    const { user } = renderScreen(
      <>
        <SeedState />
        <IgnoredFilterNotice />
      </>,
      { path: '/projects/WP?status=BOGUS' },
    );
    await user.click(screen.getByTestId('ignored-filter-clear'));
    expect(window.history.state?.usr).toEqual({ fromOverview: true, ignoredCleared: true });
  });

  it('알 수 없는 값이 없어도 알림 영역은 비어 있는 채로 있고 보이는 글·단추는 없다', () => {
    renderScreen(<IgnoredFilterNotice />, { path: '/projects/WP?priority=HIGH' });
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    expect(screen.queryByTestId('ignored-filter-clear')).toBeNull();
  });
});
