// 이슈 코멘트 이모지 반응(WP-504) — 데스크톱 "C 혼합" 진입점 E2E.
// 브라우저가 있어야 판정되는 것만 남긴다(@input) — 반응 없는 코멘트의 😊+ 는 마우스를 올려야 드러나고(투명도·헤더 자리),
// 반응 있는 코멘트의 ＋ 는 상시 보이며, 키보드로 첫 반응·취소한 뒤 포커스가 칩 ＋/헤더 「반응 추가」로 이어진다(WP-830).
// 빠른 반응·피커 payload, 칩 취소, 연속 토글, 404 롤백, AI 코멘트, 읽기 전용 칩, 수정 중 숨김·수정 뒤 유지, 반응자 호버 카드·다이얼로그는
// 페이지 테스트 src/pages/projects/issueCommentReactions.test.tsx 가 지킨다(WP-980).
import type { Page } from '@playwright/test';

import type { IssueCommentResponse, IssueDetailResponse } from '../../../src/types/issue';
import { createComment, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { expectStays } from '../../fixtures/wait';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
// createIssue() 기본 id — 반응 API 경로(/issues/{issueId}/...)에 쓰인다.
const ISSUE_ID = 100;
// createUser() 기본 id — auth fixture 의 나.
const ME_ID = 1;
// 반응 추가·취소 경로(/issues/{id}/comments/{commentId}/reactions) — 반응자 조회(/users)는 제외.
const REACTION_PATH = /\/api\/v1\/issues\/\d+\/comments\/\d+\/reactions$/;

type DetailRef = { current: IssueDetailResponse };

/** 이슈 상세 화면이 부르는 조회 API 공통 stub(issue-comments.spec 과 같은 구성). */
async function setupIssueStubs(page: Page, detailRef: DetailRef) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailRef.current) }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // 하위 태스크 섹션의 자식 검색 — 응답이 없으면 「로딩 중…」이 늦게 사라지며 코멘트 목록을 한 줄 밀어,
  // 칩 위에 둔 마우스가 칩에서 빠져 호버 카드가 닫힌다.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  );
}

/** detailRef 의 commentId 코멘트에 내 반응을 더하거나(+1) 뺀다(-1) — 서버가 저장한 것처럼. */
function applyServerReaction(detailRef: DetailRef, commentId: number, emoji: string, delta: 1 | -1) {
  const d = detailRef.current;
  detailRef.current = {
    ...d,
    comments: d.comments.map((c) => {
      if (c.id !== commentId) return c;
      const others = c.reactions.filter((r) => r.emoji !== emoji);
      const cur = c.reactions.find((r) => r.emoji === emoji);
      const count = (cur?.count ?? 0) + delta;
      const next = count > 0 ? [...others, { emoji, count, reacted: delta > 0 }] : others;
      return { ...c, reactions: next };
    }),
  };
}

/**
 * 반응 추가(POST)·취소(DELETE) stub — 성공이면 detailRef 를 갱신하고 204.
 * delayMs 로 응답을 늦춰 요청이 진행 중인 동안의 연속 클릭을 재현한다.
 */
async function stubReactionWrites(page: Page, detailRef: DetailRef, opts: { delayMs?: number } = {}) {
  await page.route(
    (url) => REACTION_PATH.test(url.pathname),
    async (route) => {
      const req = route.request();
      const commentId = Number(new URL(req.url()).pathname.split('/').at(-2));
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (req.method() === 'POST') {
        applyServerReaction(detailRef, commentId, (req.postDataJSON() as { emoji: string }).emoji, 1);
      } else if (req.method() === 'DELETE') {
        applyServerReaction(detailRef, commentId, new URL(req.url()).searchParams.get('emoji') ?? '', -1);
      } else {
        return route.fallback();
      }
      return route.fulfill({ status: 204 });
    },
  );
}

/** 코멘트 목록으로 상세를 만들고 상세 stub 을 건 뒤 이슈 상세로 이동한다. */
async function openWith(
  page: Page,
  comments: IssueCommentResponse[],
  opts: { delayMs?: number; detail?: Partial<IssueDetailResponse> } = {},
) {
  const detailRef: DetailRef = { current: createIssueDetail({ comments, ...opts.detail }) };
  await setupIssueStubs(page, detailRef);
  await stubReactionWrites(page, detailRef, opts);
  await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
  await expect(page.getByText(comments[0].body).first()).toBeVisible();
  // 위 섹션 로딩이 끝나 코멘트 목록 위치가 굳은 뒤 hover 한다(레이아웃 이동으로 호버가 풀리지 않게).
  await expect(page.getByText('로딩 중…')).toHaveCount(0);
  return detailRef;
}

/** 코멘트 카드(li) — 본문 텍스트로 찾는다. */
function commentItem(page: Page, body: string) {
  return page.locator('section[aria-label="코멘트"] ul li').filter({ hasText: body });
}

test.describe('WP-504 이슈 코멘트 반응 — 데스크톱', { tag: '@input' }, () => {
  test('hover shows add button on comment without reactions', async ({ authenticatedPage: page }) => {
    await openWith(page, [createComment({ id: 31, issueId: ISSUE_ID, authorId: 2, body: '반응 없는 코멘트' })]);
    const add = page.getByTestId('comment-reaction-add-31');
    // 반응이 없으면 본문 아래 칩 줄을 그리지 않는다(공간 0) — 😊+ 는 헤더(작성자 줄) 오른쪽 hover 액션 자리에 있다.
    await expect(page.getByTestId('comment-reaction-bar-31')).toHaveCount(0);
    const author = (await page.getByText('반응 없는 코멘트').boundingBox())!;
    expect((await add.boundingBox())!.y).toBeLessThan(author.y);
    // opacity 0 은 Playwright 기준 "보임"이라 투명도로 판정한다(채팅 툴바와 같은 방식).
    await expect(add).toHaveCSS('opacity', '0');
    await commentItem(page, '반응 없는 코멘트').hover();
    await expect(add).toHaveCSS('opacity', '1');
    await expect(add).toHaveAccessibleName('반응 추가');
    // 팝오버가 열린 동안 마우스가 카드를 떠나도 버튼이 남는다(팝오버는 portal).
    await add.click();
    await page.mouse.move(0, 0);
    await expect(add).toHaveCSS('opacity', '1');
    await expect(page.getByRole('button', { name: '👍 반응' })).toBeVisible();
  });

  test('keyboard first reaction from header keeps focus on chip plus (WP-830)', async ({ authenticatedPage: page }) => {
    await openWith(page, [createComment({ id: 51, issueId: ISSUE_ID, authorId: 2, body: '키보드 첫 반응' })]);
    // 헤더 「반응 추가」에 키보드로 닿아 Enter → 피커에서 Enter(👍).
    const header = page.getByTestId('comment-reaction-add-51');
    await header.focus();
    await page.keyboard.press('Enter');
    const quick = page.getByTestId('comment-reaction-quick-51-👍');
    await expect(quick).toBeVisible();
    await quick.focus();
    await page.keyboard.press('Enter');
    // 반응이 달리며 헤더 버튼이 칩 줄 끝 ＋ 로 바뀐다 — 포커스가 body 로 빠지지 않고 새 ＋ 로 온다.
    const pill = page.getByTestId('comment-reaction-pill-51-👍');
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
    const add = page.getByTestId('comment-reaction-bar-51').getByTestId('comment-reaction-add-51');
    await expect(add).toBeFocused();
    // 팝오버가 닫히며 다른 곳으로 포커스를 다시 빼앗지 않는다.
    await expectStays(page, () => add.evaluate((el) => el === document.activeElement), true);
  });

  test('keyboard cancel of own-only chip moves focus to header add (WP-830)', async ({ authenticatedPage: page }) => {
    await openWith(page, [
      createComment({
        id: 52,
        issueId: ISSUE_ID,
        authorId: 2,
        body: '키보드 반응 취소',
        reactions: [{ emoji: '👍', count: 1, reacted: true }],
      }),
    ]);
    const pill = page.getByTestId('comment-reaction-pill-52-👍');
    await pill.focus();
    await page.keyboard.press('Enter');
    await expect(pill).toHaveCount(0);
    // 칩 줄이 사라지고 헤더 「반응 추가」가 다시 그려진다 — 포커스가 그리로 와 드러난다.
    const header = page.getByTestId('comment-reaction-add-52');
    await expect(header).toBeFocused();
    await expect(header).toHaveCSS('opacity', '1');
    await expect(page.getByTestId('comment-reaction-bar-52')).toHaveCount(0);
  });

  test('existing reactions show persistent plus', async ({ authenticatedPage: page }) => {
    await openWith(page, [
      createComment({
        id: 35,
        issueId: ISSUE_ID,
        authorId: 2,
        body: '반응 있는 코멘트',
        reactions: [{ emoji: '👍', count: 3, reacted: true }],
      }),
    ]);
    // 마우스를 올리지 않아도 ＋ 가 보인다.
    await page.mouse.move(0, 0);
    const add = page.getByTestId('comment-reaction-add-35');
    await expect(add).toHaveCSS('opacity', '1');
    await expect(add).toBeVisible();
  });
});
