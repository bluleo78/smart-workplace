// 이슈 코멘트 이모지 반응(WP-504) — 모바일·터치. hover 가 없으니 모든 코멘트에 ＋ 를 늘 보이고, ＋ 탭 → 하단 시트(빠른 6종 + 더보기 40종),
// 칩 길게 누르기 → 반응자 시트(채팅 반응과 같은 공용 ReactorsOverlay). 코멘트 작성 권한이 없으면 ＋ 는 없고 길게 누르기만 된다.
// ＋ → 시트 → 반응 추가 payload·칩 반영과 권한 없음의 ＋ 숨김은 페이지 테스트 src/pages/mobile/issueCommentReactions.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test';

import type { IssueCommentResponse, IssueDetailResponse } from '../../../src/types/issue';
import { createChatThread } from '../../factories/chat.factory';
import { createComment, createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { json, longPress } from '../../fixtures/mobile-chat';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';

const KEY = 'WP';
const BASE = `/api/v1/projects/${KEY}/issues/7`;
const ISSUE_ID = 7;
const ME_ID = 1; // auth fixture 의 기본 사용자
// 반응 추가·취소 경로 — 반응자 조회(/users)는 제외.
const REACTION_PATH = /^\/api\/v1\/issues\/\d+\/comments\/\d+\/reactions$/;

/**
 * 이슈 7 상세 + 반응 API 스텁. 반응 추가·취소는 서버처럼 상세의 반응 집계를 갱신해 재조회 뒤에도 화면이 맞게 한다.
 * 반응자 조회는 이모지와 무관하게 같은 두 사람(나·동료)을 돌려준다.
 */
async function setup(page: Page, initial: IssueCommentResponse[], detail: Partial<IssueDetailResponse> = {}) {
  let comments = [...initial];
  const issue = createIssue({ id: ISSUE_ID, number: 7, projectKey: KEY, type: makeTaskType(), title: '코멘트 반응 이슈' });
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => r.fulfill(json(createIssueSearchResponse([], null))));
  await page.route((u) => u.pathname === BASE, (r) =>
    r.fulfill(json(createIssueDetail({ summary: issue, body: '본문', comments, ...detail }))));
  await page.route((u) => ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => u.pathname === `${BASE}/${s}`), (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `${BASE}/chat/thread`, (r) => r.fulfill(json(createChatThread({ threadId: 999, recentMessages: [] }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/labels`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([{ id: 1, type: 'PERSONAL', name: '내 드라이브' }])));
  await page.route((u) => REACTION_PATH.test(u.pathname), (r) => {
    const req = r.request();
    const id = Number(new URL(req.url()).pathname.split('/').at(-2));
    const emoji = req.method() === 'POST'
      ? (req.postDataJSON() as { emoji: string }).emoji
      : new URL(req.url()).searchParams.get('emoji') ?? '';
    const delta = req.method() === 'POST' ? 1 : -1;
    comments = comments.map((c) => {
      if (c.id !== id) return c;
      const cur = c.reactions.find((x) => x.emoji === emoji);
      const count = (cur?.count ?? 0) + delta;
      const others = c.reactions.filter((x) => x.emoji !== emoji);
      return { ...c, reactions: count > 0 ? [...others, { emoji, count, reacted: delta > 0 }] : others };
    });
    return r.fulfill({ status: 204 });
  });
  await page.route((u) => /^\/api\/v1\/issues\/\d+\/comments\/\d+\/reactions\/users$/.test(u.pathname), (r) =>
    r.fulfill(json({
      items: [{ userId: ME_ID, name: '양동희', kind: 'HUMAN' }, { userId: 20, name: '동료', kind: 'HUMAN' }],
      nextCursor: null,
      hasMore: false,
    })));
  await page.goto(`/projects/${KEY}/issues/7`);
  await expect(page.getByTestId('issue-title-heading')).toBeVisible();
}

const other = (over: Partial<IssueCommentResponse> = {}) =>
  createComment({ id: 31, issueId: ISSUE_ID, authorId: 20, authorName: '동료', body: '반응 없는 코멘트', ...over });

test.describe('WP-504 이슈 코멘트 반응 — 모바일', () => {
  test('plus is always visible on touch', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await setup(page, [
      other(),
      other({ id: 32, body: '반응 있는 코멘트', reactions: [{ emoji: '👍', count: 3, reacted: true }] }),
    ]);
    // hover 가 없으니 반응 유무와 무관하게 ＋ 가 늘 보인다(투명하지 않음).
    for (const id of [31, 32]) {
      const add = page.getByTestId(`comment-reaction-add-${id}`);
      await expect(add).toBeVisible();
      await expect(add).toHaveCSS('opacity', '1');
      // 칩과 같은 높이(pointer-coarse:min-h-8 = 32px) — 손가락으로 누르기 쉽게.
      expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    }
  });

  test('closing sheet returns focus to plus', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    // SheetTrigger 없이 여는 시트라 닫힘 포커스를 직접 되돌린다 — 고르지 않고 닫아도(ESC) 연 ＋ 로 돌아온다.
    await setup(page, [other()]);
    const add = page.getByTestId('comment-reaction-add-31');
    await add.tap();
    const sheet = page.getByTestId('comment-reaction-sheet-31');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();
  });

  test('long press chip opens reactors sheet', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await setup(page, [
      other({
        reactions: [
          { emoji: '👍', count: 2, reacted: true },
          { emoji: '🎉', count: 1, reacted: false },
        ],
      }),
    ]);
    const writes = trackRequests(page, 'ANY', REACTION_PATH);
    const pill = page.getByTestId('comment-reaction-pill-31-🎉');
    // 코멘트 탭은 본문 아래라 첫 화면 밖일 수 있다 — CDP 터치는 화면 좌표라 먼저 보이게 스크롤한다.
    await pill.scrollIntoViewIfNeeded();
    await longPress(page, pill);
    const sheet = page.getByTestId('reactors-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('reactors-tab-🎉')).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.getByText('이 코멘트에 반응한 사람')).toBeAttached();
    await expect(sheet.getByTestId('reactor-row-me')).toBeVisible();
    await expect(sheet.getByTestId('reactor-row-20')).toContainText('동료');
    // 손을 뗄 때 오는 click 이 칩 토글로 새지 않는다.
    await expect(page.getByTestId('comment-reaction-count-31-🎉')).toHaveText('1');
    await expectStays(page, () => writes.count(), 0, { ms: 300 });
  });

  test('reader long press opens reactors without plus', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    // 코멘트 작성 권한이 없으면 ＋ 는 없고, 칩은 눌러도 토글되지 않지만 길게 눌러 반응한 사람은 볼 수 있다.
    await setup(page, [other({ reactions: [{ emoji: '👍', count: 2, reacted: false }] })], { viewerCanEditContent: false });
    const writes = trackRequests(page, 'ANY', REACTION_PATH);
    await expect(page.getByTestId('comment-reaction-pill-31-👍')).toBeVisible();
    await expect(page.locator('[data-testid^="comment-reaction-add-"]')).toHaveCount(0);
    const pill = page.getByTestId('comment-reaction-pill-31-👍');
    await pill.scrollIntoViewIfNeeded();
    await longPress(page, pill);
    await expect(page.getByTestId('reactors-sheet')).toBeVisible();
    await expectStays(page, () => writes.count(), 0, { ms: 300 });
  });

  test('many chips wrap without horizontal overflow', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const body = '스테이징에서 재현 확인했습니다. 첨부 업로드 시 100MB 근처 파일은 프록시 타임아웃(60s)에 먼저 걸리는 것 같아서, ingress 쪽 proxy-read-timeout 도 같이 올려야 할 것 같습니다. 배포 전에 values 를 한 번 더 확인 부탁드립니다.';
    const emojis = ['👍', '❤️', '😄', '🎉', '😢', '🙏', '🚀', '👀', '🔥', '✅'];
    await setup(page, [
      other({ body, reactions: emojis.map((emoji, i) => ({ emoji, count: i + 1, reacted: i % 3 === 0 })) }),
    ]);
    const bar = page.getByTestId('comment-reaction-bar-31');
    await expect(bar).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // 칩이 여러 줄로 꺾이고, ＋ 까지 카드 오른쪽 안에 머문다.
    const card = page.getByRole('listitem').filter({ hasText: '스테이징에서 재현' });
    const cardBox = (await card.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(barBox.height).toBeGreaterThan(40);
    const addBox = (await page.getByTestId('comment-reaction-add-31').boundingBox())!;
    expect(addBox.x + addBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  });
});
