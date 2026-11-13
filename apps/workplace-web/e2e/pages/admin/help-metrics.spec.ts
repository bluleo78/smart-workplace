// /settings/help-metrics — 도움말 측정 화면 배선(@wiring, WP-1512).
// 탭·기간 → 요청 파라미터, 표 셀, 빈·오류 상태는 src/pages/admin/helpMetrics.test.tsx 가 지킨다.
// 여기선 라우트·관리자 가드·API 연결로 한 행이 그려지는지만 본다.

import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';

test.describe('/settings/help-metrics — 도움말 측정', () => {
  test('화면별 열기 한 행이 표에 그려진다', { tag: '@wiring' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    await mockApi(page, 'GET', '/api/v1/help/metrics', {
      kind: 'OPEN',
      days: 7,
      items: [{ route: '/mail', helpId: 'mail', term: '', count: 3, lastAt: '2026-11-12T01:00:00Z' }],
    });

    await page.goto('/settings/help-metrics');
    await expect(page.getByRole('heading', { name: '도움말 측정' })).toBeVisible();

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('/mail');
  });
});

// 휴대폰 폭(390px)에서 탭 세 개가 화면보다 넓어 페이지 전체가 옆으로 밀리던 결함(WP-1512 라이브 검증) —
// 탭 줄은 제 안에서만 가로로 밀리고, 마지막 탭을 눌러도 문서·본문이 옆으로 밀리지 않아야 한다.
test.describe('/settings/help-metrics — 휴대폰 폭', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('마지막 탭을 눌러도 페이지가 옆으로 밀리지 않는다', { tag: '@layout' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    await mockApi(page, 'GET', '/api/v1/help/metrics', {
      kind: 'AI_GAP',
      days: 7,
      items: [{ route: '', helpId: 'members', term: '외부 손님 계정을 만료일 지나면 자동으로 막을 수 있나요?', count: 2, lastAt: '2026-11-12T01:00:00Z' }],
    });

    await page.goto('/settings/help-metrics');
    const lastTab = page.getByRole('tab', { name: '매뉴얼에서 못 찾은 질문' });
    await lastTab.click();
    await expect(lastTab).toHaveAttribute('data-state', 'active');
    await expect(page.locator('tbody tr')).toHaveCount(1);

    // 탭 줄 오른쪽 끝이 화면 안 — 넘치는 만큼은 탭 줄 안에서 스크롤된다
    const list = await page.getByRole('tablist').boundingBox();
    expect(list).not.toBeNull();
    expect(list!.x).toBeGreaterThanOrEqual(0);
    expect(list!.x + list!.width).toBeLessThanOrEqual(390 + 1);

    // 탭이 글자보다 좁게 줄어 이름이 겹치지 않는다(탭 너비 ≥ 글자 너비)
    const squeezed = await page.getByRole('tab').evaluateAll((tabs) =>
      tabs.filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent),
    );
    expect(squeezed).toEqual([]);

    // 긴 질문이 있어도 횟수 열은 첫 화면 안에 보인다
    const countHead = await page.getByRole('columnheader', { name: '횟수' }).boundingBox();
    expect(countHead).not.toBeNull();
    expect(countHead!.x + countHead!.width).toBeLessThanOrEqual(390 + 1);

    // 문서와 그 안의 어떤 스크롤 조상도 옆으로 밀리지 않았다(표 자체 컨테이너·탭 줄은 제외)
    const shifted = await page.evaluate(() => {
      const out: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('documentElement');
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('main, main *'))) {
        if (el.scrollLeft > 0 && el.getAttribute('role') !== 'tablist' && el.dataset.slot !== 'table-container') {
          out.push(el.tagName + '.' + el.className);
        }
      }
      return out;
    });
    expect(shifted).toEqual([]);
  });
});
