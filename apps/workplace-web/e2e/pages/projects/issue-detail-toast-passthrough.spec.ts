// 알림(Sonner 토스트) 포인터 통과 E2E (WP-2084) — 오른쪽 위 성공 알림이 아래 「제목 편집」 단추를 덮어도 단추가 눌려야 한다.
// 왜 E2E: 맨 위 요소(elementFromPoint)·상자 겹침은 jsdom 이 레이아웃을 못 재서 거짓으로 통과한다(@layout).
// 에러 알림은 픽스처가 통과시키므로, 히트테스트 전에 dropToastPassthrough 로 그 규칙을 지운다.
import type { Page } from '@playwright/test';
import { createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { mockApis } from '../../fixtures/api-mock';
import { dropToastPassthrough, expect, test } from '../../fixtures/auth.fixture';

const KEY = 'WP';
const BASE = `/api/v1/projects/${KEY}/issues/8`;
// 긴 제목 — 한 줄을 가득 채워 「제목 편집」 단추가 오른쪽 끝(알림 아래)으로 가게 한다.
const LONG_TITLE = '알림 포인터 통과 확인용 긴 제목 '.repeat(4).trim();

/** 이슈 상세 화면에 필요한 API 를 스텁한다. onPatch 가 주어지면 제목 저장(PATCH) 뒤 상세가 그 제목을 돌려준다. */
async function setupIssuePage(page: Page, options: { onPatch?: () => string } = {}) {
  let title = '짧은 제목';
  const issue = createIssue({ id: 2, number: 8, projectKey: KEY, title });
  await mockApis(page, [
    { method: 'GET', path: `/api/v1/projects/${KEY}`, body: createProject({ key: KEY }) },
    { method: 'GET', path: `${BASE}/chat/thread`, body: createChatThread({ threadId: 999, recentMessages: [] }) },
    ...['watchers', 'labels', 'attachments', 'drive-links'].map((sub) => ({ method: 'GET' as const, path: `${BASE}/${sub}`, body: [] })),
    ...[`/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`, '/api/v1/drive/spaces'].map((path) => ({ method: 'GET' as const, path, body: [] })),
  ]);
  await page.route(
    (url) => url.pathname === BASE,
    (route) => {
      if (route.request().method() === 'PATCH' && options.onPatch) title = options.onPatch();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueDetail({ summary: { ...issue, title } })) });
    },
  );
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** 제목 편집 → 저장해 성공 알림을 띄운다. */
async function saveTitle(page: Page, title: string) {
  await page.goto(`/projects/${KEY}/issues/8`);
  await page.getByTestId('issue-title-edit').click();
  const input = page.getByRole('textbox', { name: '이슈 제목' });
  await input.fill(title);
  await input.press('Enter');
  await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
}

test.describe('알림 포인터 통과 (WP-2084)', { tag: ['@layout'] }, () => {
  test('알림이 아래 단추를 덮어도 단추가 눌린다', async ({ authenticatedPage: page }) => {
    await setupIssuePage(page, { onPatch: () => LONG_TITLE });
    await saveTitle(page, LONG_TITLE);

    // 저장 성공 알림이 떠 있는 동안 — 긴 제목으로 단추가 오른쪽 끝에 와 알림과 겹친다(덮지 않으면 아래 click 이 의미 없다).
    const edit = page.getByTestId('issue-title-edit');
    const t = (await page.locator('[data-sonner-toast]').first().boundingBox())!;
    const b = (await edit.boundingBox())!;
    const overlap = t.x < b.x + b.width && b.x < t.x + t.width && t.y < b.y + b.height && b.y < t.y + t.height;
    expect(overlap, `알림(${JSON.stringify(t)})과 단추(${JSON.stringify(b)})가 겹쳐야 테스트가 의미 있다`).toBe(true);

    // click 의 actionability(보임·맨 위 히트)가 단추가 눌리는지를 판정한다. 픽스처의 에러 알림 통과 규칙은 지워 앱 CSS 만 본다.
    await dropToastPassthrough(page);
    await edit.click({ timeout: 1000 });
    await expect(page.getByRole('textbox', { name: '이슈 제목' })).toBeVisible();
  });

  // 숨은(4번째 이후)·앞 알림 뒤에 접힌 알림은 단추도 몸통도 클릭을 받지 않는다 — 앞 알림 탭이 뒤의 「실행 취소」로 새거나
  // 뒤 알림이 아래 페이지 클릭을 삼키면 안 된다. 속성 조합별 판정은 토스터(ol)에 Sonner 가 다는 속성 그대로의 알림 li 를 심어
  // 앱 CSS 만으로 본다(진짜 실행 취소 알림 스택은 messaging-phase4.spec 의 WP-2084 테스트). 대조군(펼쳐진 보이는 알림)은 눌려야 한다.
  // 클릭이 실제로 닿는 곳은 elementFromPoint 가 아니라 진짜 마우스 클릭의 event.target 으로 읽는다.
  test('숨은·뒤에 접힌 알림은 단추·몸통 클릭을 받지 않고 아래로 통과시킨다', async ({ authenticatedPage: page }) => {
    await setupIssuePage(page)
    await saveTitle(page, '저장해서 알림 띄우기')

    // 알림 3종을 서로 겹치지 않는 자리(위에서 200·300·400px)에 심는다. 각 알림에 단추(오른쪽)와 빈 몸통(왼쪽) 점이 있다.
    const points = await page.evaluate(() => {
      const list = document.querySelector('[data-sonner-toaster]')!
      const specs: [string, number, Record<string, string>][] = [
        ['control', 200, { 'data-visible': 'true', 'data-expanded': 'true', 'data-front': 'false' }],
        // 펼침 상태로 둬 접힌 뒤 알림 규칙과 겹치지 않게 — data-visible=false 규칙만 판정한다.
        ['hidden', 300, { 'data-visible': 'false', 'data-expanded': 'true', 'data-front': 'false' }],
        ['back', 400, { 'data-visible': 'true', 'data-expanded': 'false', 'data-front': 'false' }],
      ]
      return specs.flatMap(([id, top, attrs]) => {
        const li = document.createElement('li')
        li.setAttribute('data-sonner-toast', '')
        li.setAttribute('data-probe', id)
        for (const [k, v] of Object.entries(attrs)) li.setAttribute(k, v)
        li.style.cssText = `position:fixed;top:${top}px;left:500px;width:320px;height:60px;z-index:1000;opacity:1`
        const btn = document.createElement('button')
        btn.textContent = '실행 취소'
        btn.style.cssText = 'position:absolute;top:10px;right:10px;width:80px;height:30px'
        li.appendChild(btn)
        list.appendChild(li)
        const l = li.getBoundingClientRect()
        const r = btn.getBoundingClientRect()
        return [
          { key: `${id}-button`, x: r.x + r.width / 2, y: r.y + r.height / 2 },
          { key: `${id}-body`, x: l.x + 20, y: l.y + 30 },
        ]
      })
    })

    // 진짜 클릭을 한 점씩 보내 mousedown 의 event.target 이 어느 알림 안인지(아니면 아래 페이지인지) 기록한다.
    await page.evaluate(() => {
      const w = window as unknown as { __lastClick: string }
      w.__lastClick = ''
      document.addEventListener('mousedown', (e) => (w.__lastClick = (e.target as Element).closest('[data-probe]')?.getAttribute('data-probe') ?? 'page'), true)
    })
    const landed: Record<string, string> = {}
    for (const p of points) {
      await page.evaluate(() => ((window as unknown as { __lastClick: string }).__lastClick = '(없음)'))
      await page.mouse.click(p.x, p.y)
      landed[p.key] = await page.evaluate(() => (window as unknown as { __lastClick: string }).__lastClick)
    }
    expect(landed).toEqual({
      'control-button': 'control',
      'control-body': 'control',
      'hidden-button': 'page',
      'hidden-body': 'page',
      'back-button': 'page',
      'back-body': 'page',
    })
  })
})
