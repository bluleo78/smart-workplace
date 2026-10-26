// 채팅 서식(WP-101) — 이슈 채팅 데스크톱. 작성창 「Aa」 서식 줄 → 전송 payload 마크다운, 서식 메시지 렌더, 수정 시 서식 복원·저장.
import type { Page } from '@playwright/test';

import { createChatMember, createChatMessage, createChatThread } from '../../factories/chat.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { json, KEY, stubIssue } from '../../fixtures/mobile-chat';
import { trackRequests } from '../../fixtures/requests';

/** 이슈 MOB-1 채팅 + 전송·수정 스텁. stubIssue 의 본인 메시지(502)는 서식 본문으로 덮는다. */
async function stubFormattedIssueChat(page: Page) {
  await stubIssue(page);
  const own = createChatMessage({
    id: 502, threadId: 100, authorId: 1, authorName: 'me',
    body: '*검토* 끝 — **재현 안 됨**\n\n1. 로그 확인\n2. 배포',
  });
  const peer = createChatMessage({ id: 501, threadId: 100, authorId: 20, authorName: '동료', body: '확인했습니다\n  a_b #해시' });
  // 드로어는 스레드의 최근 메시지로 먼저 그린다 — 같은 두 메시지로 덮는다.
  const thread = createChatThread({
    threadId: 100,
    members: [createChatMember({ userId: 1, lastReadMessageId: 502 }), createChatMember({ userId: 20, name: '동료' })],
    recentMessages: [peer, own],
  });
  await page.route(`**/api/v1/projects/${KEY}/issues/1/chat/thread`, (r) => r.fulfill(json(thread)));
  await page.route('**/api/v1/chat/threads/100/messages', (r) => {
    if (r.request().method() === 'GET') return r.fulfill(json({ items: [own, peer], nextCursor: null, hasMore: false }));
    const p = r.request().postDataJSON() as { body: string };
    return r.fulfill(json(createChatMessage({ id: 600, threadId: 100, authorId: 1, authorName: 'me', body: p.body })));
  });
  await page.route('**/api/v1/chat/messages/502', (r) =>
    r.fulfill(json({ ...own, body: (r.request().postDataJSON() as { body: string }).body, editedAt: '2026-09-30T04:00:00Z' })),
  );
  return trackRequests(page, 'POST', '/api/v1/chat/threads/100/messages');
}

// 서식 줄 토글·코드 블록 안 Shift+Enter·서식 목록 끝(End)에서 이어 쓰기는 contenteditable 실제 키 입력이라 E2E(@input)로 둔다.
test.describe('채팅 서식 (WP-101) — 이슈 채팅', { tag: '@input' }, () => {
  test('서식 줄로 기울임·코드 블록을 쓰면 마크다운으로 보내고, 서식 메시지는 서식으로 그린다', async ({ authenticatedPage: page }) => {
    const sends = await stubFormattedIssueChat(page);
    await page.goto(`/projects/${KEY}/issues/1?chat=1`);
    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.getByTestId('chat-composer-input-format').click();
    await page.getByTestId('chat-composer-input-format-italic').click();
    await page.keyboard.type('메모');
    await page.getByTestId('chat-composer-input-format-italic').click();
    await page.keyboard.press('Shift+Enter');
    await page.getByTestId('chat-composer-input-format-codeBlock').click();
    await expect(page.getByTestId('chat-composer-input-format-codeBlock')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('a = 1');
    // 코드 블록 안 Shift+Enter = 줄바꿈.
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('b = 2');
    await page.keyboard.press('Enter');
    await expect.poll(() => sends.bodies().map((b) => (b as { body: string }).body)).toEqual(['*메모*\n```\na = 1\nb = 2\n```']);

    const own = page.getByTestId('chat-message-body-502');
    await expect(own.locator('em')).toHaveText('검토');
    await expect(own.locator('strong')).toHaveText('재현 안 됨');
    await expect(own.locator('ol > li')).toHaveText(['로그 확인', '배포']);
    // 예전 평문 — 들여쓰기·밑줄 문자·# 는 글자 그대로.
    await expect(page.getByTestId('chat-message-body-501')).toHaveText('확인했습니다\n  a_b #해시', { useInnerText: true });
  });

  test('서식 메시지를 수정하면 서식이 복원되고 고친 그대로 저장된다', async ({ authenticatedPage: page }) => {
    await stubFormattedIssueChat(page);
    await page.goto(`/projects/${KEY}/issues/1?chat=1`);
    await page.getByTestId('chat-message-502').hover();
    await page.getByTestId('chat-message-edit-502').click();
    const editor = page.getByTestId('chat-message-editor-input');
    await expect(editor.locator('em')).toHaveText('검토');
    await expect(editor.locator('ol > li')).toHaveText(['로그 확인', '배포']);
    const patch = page.waitForRequest((r) => r.url().endsWith('/api/v1/chat/messages/502') && r.method() === 'PATCH');
    await editor.locator('li').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' 완료');
    await page.keyboard.press('Enter');
    expect(((await patch).postDataJSON() as { body: string }).body).toBe('*검토* 끝 — **재현 안 됨**\n\n1. 로그 확인\n2. 배포 완료');
  });
});
