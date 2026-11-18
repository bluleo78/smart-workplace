// 메일 서명 설정 E2E(WP-1517) — 브라우저가 있어야 판정되는 두 가지만 둔다.
// @input·@layout: 실제 붙여넣기(ClipboardEvent + DataTransfer text/html)로 Outlook 서명이 「붙여넣은 서명 · 원본 그대로」 미리 보기로
//   바뀌고(WP-1726), 격리 iframe 안에서 클래스 서식·링크 원본 색이 실제로 그려지는가(계산된 스타일은 jsdom 이 잴 수 없다).
// @wiring: /settings/mail 진입 → 서명 조회 API → 「서명」 카드에 저장된 서명·스위치가 보인다.
// 스위치·저장 payload·비우기·오류·이미지 인증 요청은 src/pages/settings/mailSignature.test.tsx(화면 테스트)가 지킨다.
import { createMailSignature } from '../../factories/mailSignature.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';

/** 1×1 PNG — 붙여 넣은 로고 이미지 대신. */
const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Outlook 데스크톱 서명을 복사했을 때 클립보드 text/html 과 같은 모양 — 껍데기·클래스 규칙(MsoNormal)·표·링크(원본 인라인 색)·이미지. */
const OUTLOOK_HTML =
  `<html><head><style><!--p.MsoNormal{font-family:"Malgun Gothic";font-size:10pt;color:#1F4E79}--></style></head><body>` +
  `<!--StartFragment--><table><tr><td><p class=MsoNormal>홍길동</p>` +
  `<p class=MsoNormal><a href="https://example.com" style="color:black;text-decoration:none">example</a></p>` +
  `<p><img src="${PNG_DATA_URI}" width="40" height="40"></p></td></tr></table><!--EndFragment--></body></html>`;

test.describe('메일 서명 설정', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // 같은 화면의 계정 목록이 부르는 조회 — 미스텁이면 dev 프록시로 샌다.
    await mockApi(page, 'GET', '/api/v1/mail/oauth/m365/status', { preferred: false });
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
  });

  test('Outlook 서식이 든 HTML 을 붙여 넣으면 원본 그대로 미리 보기로 바뀌고 링크 색이 원본대로 그려진다', { tag: ['@input', '@layout'] }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'PUT', '/api/v1/mail/signature', createMailSignature({ html: '<p>저장됨</p>', pasted: true }));
    const puts = trackRequests(page, 'PUT', '/api/v1/mail/signature');
    await page.goto('/settings/mail');

    const editor = page.getByTestId('mail-signature-editor');
    await expect(editor).toBeVisible();
    await editor.click();
    // 실제 브라우저의 paste 이벤트 — 편집기가 ProseMirror 보다 먼저 받아 「원본 그대로」 모드로 넘긴다.
    await editor.evaluate((el, html) => {
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', '홍길동\nexample');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, OUTLOOK_HTML);

    const preview = page.getByTestId('mail-signature-pasted');
    await expect(preview.getByText('붙여넣은 서명 · 원본 그대로')).toBeVisible();
    await expect(editor).toHaveCount(0);
    // 격리 iframe 안 — 클래스 규칙(MsoNormal)이 인라인으로 풀려 글꼴·색이 그려지고, 링크는 원본 인라인 색(검정·밑줄 없음)이 이긴다.
    const frame = preview.frameLocator('iframe[title="서명"]');
    await expect(frame.getByText('홍길동')).toHaveCSS('color', 'rgb(31, 78, 121)');
    await expect(frame.getByText('홍길동')).toHaveCSS('font-size', '13.3333px');
    const link = frame.getByRole('link', { name: 'example' });
    await expect(link).toHaveCSS('color', 'rgb(0, 0, 0)');
    await expect(link).toHaveCSS('text-decoration-line', 'none');
    // 높이는 내용에 맞춘다 — 세 줄(글·링크·로고)이 잘리지 않는다.
    await expect.poll(async () => (await preview.locator('iframe[title="서명"]').boundingBox())?.height ?? 0).toBeGreaterThan(40);

    await page.getByRole('button', { name: '저장' }).click();
    await puts.waitFor(1);
    const body = puts.lastBody<{ html: string; autoNew: boolean; autoReply: boolean; pasted: boolean }>();
    expect(body?.pasted).toBe(true);
    expect(body?.html).toContain('Malgun Gothic');
    expect(body?.html).toContain('font-size:10pt');
    expect(body?.html).toMatch(/color:\s*#1F4E79/i);
    expect(body?.html).toContain('<table');
    expect(body?.html).not.toMatch(/<style|<!--/);
    expect(body?.html).toContain('href="https://example.com"');
    expect(body?.html).toContain('src="data:image/png;base64,');
    expect(body).toMatchObject({ autoNew: true, autoReply: false });
  });

  test('설정 › 메일 계정에 서명 카드가 보이고 저장된 서명을 불러온다', { tag: ['@wiring'] }, async ({ authenticatedPage: page }) => {
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/signature',
      createMailSignature({ html: '<p>홍길동 · 개발팀</p>', autoNew: false, autoReply: true, updatedAt: '2026-11-12T00:00:00Z' }),
    );
    await page.goto('/settings/mail');

    const card = page.getByTestId('mail-signature-card');
    // exact — 「서명을 자동으로 넣을 메일」 소제목도 '서명' 을 포함한다.
    await expect(card.getByRole('heading', { name: '서명', exact: true })).toBeVisible();
    await expect(card.getByTestId('mail-signature-editor')).toContainText('홍길동 · 개발팀');
    await expect(card.getByRole('switch', { name: '새 메일' })).not.toBeChecked();
    await expect(card.getByRole('switch', { name: '답장·전달' })).toBeChecked();
    await expect(card.getByRole('button', { name: '저장' })).toBeDisabled();
  });
});
