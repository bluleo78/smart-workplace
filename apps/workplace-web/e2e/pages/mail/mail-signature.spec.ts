// 메일 서명 설정 E2E(WP-1517) — 브라우저가 있어야 판정되는 두 가지만 둔다.
// @input: 실제 붙여넣기(ClipboardEvent + DataTransfer text/html)를 ProseMirror 가 받아 Outlook 서식(글꼴·색·링크·이미지)을 남기는가.
// @wiring: /settings/mail 진입 → 서명 조회 API → 「서명」 카드에 저장된 서명·스위치가 보인다.
// 스위치·저장 payload·비우기·오류·이미지 인증 요청은 src/pages/settings/mailSignature.test.tsx(화면 테스트)가 지킨다.
import { createMailSignature } from '../../factories/mailSignature.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';

/** 1×1 PNG — 붙여 넣은 로고 이미지 대신. */
const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Outlook 웹 서명을 복사했을 때 클립보드 text/html 과 같은 모양 — 클래스 서식(MsoNormal)·span style·링크·이미지. */
const OUTLOOK_HTML =
  `<p class=MsoNormal><span style="font-family:'Malgun Gothic';color:#1F4E79">홍길동</span></p>` +
  `<p><a href="https://example.com">example</a></p>` +
  `<p><img src="${PNG_DATA_URI}"></p>`;

test.describe('메일 서명 설정', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // 같은 화면의 계정 목록이 부르는 조회 — 미스텁이면 dev 프록시로 샌다.
    await mockApi(page, 'GET', '/api/v1/mail/oauth/m365/status', { preferred: false });
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
  });

  test('Outlook 서식이 든 HTML 을 붙여 넣으면 글꼴·색·링크가 남는다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'PUT', '/api/v1/mail/signature', createMailSignature({ html: '<p>저장됨</p>' }));
    const puts = trackRequests(page, 'PUT', '/api/v1/mail/signature');
    await page.goto('/settings/mail');

    const editor = page.getByTestId('mail-signature-editor');
    await expect(editor).toBeVisible();
    await editor.click();
    // 실제 브라우저의 paste 이벤트 — ProseMirror 의 붙여넣기 처리(파싱·스키마 맞춤)를 그대로 탄다.
    await editor.evaluate((el, html) => {
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', '홍길동\nexample');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, OUTLOOK_HTML);

    await expect(editor.getByText('홍길동')).toBeVisible();
    // 붙여 넣은 글꼴·색이 편집기 화면에도 남는다.
    await expect(editor.locator('span[style*="Malgun Gothic"]')).toHaveCSS('color', 'rgb(31, 78, 121)');
    await expect(editor.getByTestId('signature-image').locator('img')).toHaveAttribute('src', PNG_DATA_URI);

    await page.getByRole('button', { name: '저장' }).click();
    await puts.waitFor(1);
    const body = puts.lastBody<{ html: string; autoNew: boolean; autoReply: boolean }>();
    expect(body?.html).toContain('font-family');
    expect(body?.html).toContain('Malgun Gothic');
    // 브라우저가 style 을 다시 써서 #1F4E79 가 rgb(31, 78, 121) 로 나올 수 있다 — 같은 색이면 된다.
    expect(body?.html).toMatch(/color:\s*(#1F4E79|rgb\(31, 78, 121\))/i);
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
