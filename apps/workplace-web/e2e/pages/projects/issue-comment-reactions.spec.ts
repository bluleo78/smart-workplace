// 이슈 코멘트 이모지 반응(WP-504) — 데스크톱 "C 혼합" 진입점 E2E.
// 반응 있는 코멘트는 칩 끝 ＋ 상시, 반응 없는 코멘트는 마우스를 올려야 😊+ 가 드러난다. 칩·호버 카드·반응자 다이얼로그는
// 채팅 공용 컴포넌트(components/reactions)를 그대로 쓴다. 백엔드 없이 page.route 로 상세·반응 API 를 모킹하고,
// 반응 추가·취소 stub 은 detailRef 를 서버처럼 갱신해 실패 롤백·재조회 뒤에도 화면이 서버 상태와 맞는지 본다.
import type { Page } from '@playwright/test';

import type { IssueCommentResponse, IssueDetailResponse } from '../../../src/types/issue';
import { createAgentComment, createComment, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
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

/** 반응자 조회 stub — 이모지별 사람 목록을 한 페이지로 돌려준다. */
async function stubReactors(
  page: Page,
  commentId: number,
  byEmoji: Record<string, { userId: number; name: string }[]>,
) {
  await page.route(
    (url) => url.pathname === `/api/v1/issues/${ISSUE_ID}/comments/${commentId}/reactions/users`,
    (route) => {
      const emoji = new URL(route.request().url()).searchParams.get('emoji') ?? '';
      const items = (byEmoji[emoji] ?? []).map((r) => ({ kind: 'HUMAN', ...r }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
      });
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

test.describe('WP-504 이슈 코멘트 반응 — 데스크톱', () => {
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

  test('editing own comment hides reactions', async ({ authenticatedPage: page }) => {
    await openWith(page, [
      createComment({
        id: 40,
        issueId: ISSUE_ID,
        authorId: ME_ID,
        body: '내 코멘트',
        reactions: [{ emoji: '👍', count: 1, reacted: false }],
      }),
    ]);
    await expect(page.getByTestId('comment-reaction-bar-40')).toBeVisible();
    await commentItem(page, '내 코멘트').hover();
    await page.getByRole('button', { name: '코멘트 수정' }).click();
    await expect(page.getByTestId('issue-comment-edit-input')).toBeVisible();
    await expect(page.getByTestId('comment-reaction-bar-40')).toHaveCount(0);
    await page.getByTestId('issue-comment-edit-cancel').click();
    await expect(page.getByTestId('comment-reaction-pill-40-👍')).toBeVisible();
  });

  test('quick reaction adds chip and request', async ({ authenticatedPage: page }) => {
    await openWith(page, [createComment({ id: 32, issueId: ISSUE_ID, authorId: 2, body: '빠른 반응 대상' })]);
    const posts = trackRequests(page, 'POST', REACTION_PATH);
    await commentItem(page, '빠른 반응 대상').hover();
    await page.getByTestId('comment-reaction-add-32').click();
    // 빠른 6종이 모두 보인다.
    for (const e of ['👍', '❤️', '😄', '🎉', '😢', '🙏']) {
      await expect(page.getByTestId(`comment-reaction-quick-32-${e}`)).toBeVisible();
    }
    await page.getByTestId('comment-reaction-quick-32-👍').click();

    const pill = page.getByTestId('comment-reaction-pill-32-👍');
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('comment-reaction-count-32-👍')).toHaveText('1');
    await posts.waitFor(1);
    expect(posts.lastBody()).toEqual({ emoji: '👍' });
    expect(posts.lastUrl()?.pathname).toBe(`/api/v1/issues/${ISSUE_ID}/comments/32/reactions`);
    // 선택하면 팝오버가 닫힌다.
    await expect(page.getByTestId('comment-reaction-quick-32-👍')).toHaveCount(0);
  });

  test('more opens full emoji set', async ({ authenticatedPage: page }) => {
    await openWith(page, [createComment({ id: 39, issueId: ISSUE_ID, authorId: 2, body: '더보기 대상' })]);
    const posts = trackRequests(page, 'POST', REACTION_PATH);
    await commentItem(page, '더보기 대상').hover();
    await page.getByTestId('comment-reaction-add-39').click();
    await page.getByTestId('comment-reaction-more-39').click();
    // 채팅 피커와 같은 40종 그리드.
    await expect(page.locator('[data-testid^="comment-reaction-pick-39-"]')).toHaveCount(40);
    await page.getByTestId('comment-reaction-pick-39-🚀').click();
    await expect(page.getByTestId('comment-reaction-pill-39-🚀')).toHaveAttribute('aria-pressed', 'true');
    await posts.waitFor(1);
    expect(posts.lastBody()).toEqual({ emoji: '🚀' });
  });

  test('click own chip removes reaction', async ({ authenticatedPage: page }) => {
    await openWith(page, [
      createComment({
        id: 33,
        issueId: ISSUE_ID,
        authorId: 2,
        body: '내 반응 취소 대상',
        reactions: [{ emoji: '👍', count: 1, reacted: true }],
      }),
    ]);
    const deletes = trackRequests(page, 'DELETE', REACTION_PATH);
    await page.getByTestId('comment-reaction-pill-33-👍').click();
    await expect(page.getByTestId('comment-reaction-pill-33-👍')).toHaveCount(0);
    await deletes.waitFor(1);
    expect(deletes.lastUrl()?.searchParams.get('emoji')).toBe('👍');
  });

  test('rapid double toggle', async ({ authenticatedPage: page }) => {
    // 남의 반응 1개가 있는 칩 — 두 번 눌러도 칩이 남아 두 번째 클릭이 닿는다.
    // 응답을 늦춰 두 번째 클릭이 첫 요청 진행 중에 일어나게 한다(렌더 클로저로 판정하면 add 가 두 번 나간다, #702).
    await openWith(
      page,
      [
        createComment({
          id: 34,
          issueId: ISSUE_ID,
          authorId: 2,
          body: '연속 토글 대상',
          reactions: [{ emoji: '🎉', count: 1, reacted: false }],
        }),
      ],
      { delayMs: 400 },
    );
    const writes = trackRequests(page, 'ANY', REACTION_PATH);
    const pill = page.getByTestId('comment-reaction-pill-34-🎉');
    await pill.click();
    await pill.click();
    await writes.waitFor(2);
    expect(writes.requests().map((r) => r.method())).toEqual(['POST', 'DELETE']);
    // 최종 화면은 원래 상태 — 남의 반응 1개, 나는 누르지 않음.
    await expect(pill).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('comment-reaction-count-34-🎉')).toHaveText('1');
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

  test('hover card lists reactors and show all opens dialog', async ({ authenticatedPage: page }) => {
    await openWith(page, [
      createComment({
        id: 36,
        issueId: ISSUE_ID,
        authorId: 2,
        body: '반응자 확인 대상',
        reactions: [
          { emoji: '👍', count: 3, reacted: true },
          { emoji: '🙏', count: 1, reacted: false },
        ],
      }),
    ]);
    await stubReactors(page, 36, {
      '👍': [
        { userId: ME_ID, name: '양동희' },
        { userId: 3, name: '이영희' },
        { userId: 4, name: '박지훈' },
      ],
      '🙏': [{ userId: 3, name: '이영희' }],
    });
    await page.getByTestId('comment-reaction-pill-36-👍').hover();
    await expect(page.getByTestId('reaction-hover-summary-36')).toHaveText(
      '나, 이영희, 박지훈이 반응했습니다',
    );
    await page.getByTestId('reaction-hover-all-36').click();

    const dialog = page.getByTestId('reactors-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('reactors-tab-👍')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByText('이 코멘트에 반응한 사람')).toBeAttached();
    await expect(dialog.getByTestId('reactor-row-me')).toContainText('양동희');
    await expect(dialog.locator('[data-testid^="reactor-row-"]')).toHaveCount(3);
    await dialog.getByTestId('reactors-tab-🙏').click();
    await expect(dialog.locator('[data-testid^="reactor-row-"]')).toHaveCount(1);
  });

  test('add on deleted comment rolls back', async ({ authenticatedPage: page }) => {
    await openWith(page, [
      createComment({ id: 37, issueId: ISSUE_ID, authorId: 2, body: '지워진 코멘트' }),
    ]);
    // 나중에 등록한 route 가 먼저 — 코멘트가 이미 지워져 서버가 메시지 없는 404 를 준다.
    await page.route(
      (url) => REACTION_PATH.test(url.pathname),
      (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );
    await commentItem(page, '지워진 코멘트').hover();
    await page.getByTestId('comment-reaction-add-37').click();
    await page.getByTestId('comment-reaction-quick-37-❤️').click();
    // 기본 문구 토스트 + 칩 롤백(서버 상태엔 반응이 없다).
    await expect(page.getByText('반응을 저장하지 못했어요')).toBeVisible();
    await expect(page.getByTestId('comment-reaction-pill-37-❤️')).toHaveCount(0);
    // 반응 0개로 돌아오면 칩 줄도 사라지고(빈 줄 없음) 추가 버튼은 다시 헤더 자리로 간다.
    await expect(page.getByTestId('comment-reaction-bar-37')).toHaveCount(0);
    await expect(commentItem(page, '지워진 코멘트').getByTestId('comment-reaction-add-37')).toHaveCount(1);
  });

  test('ai comment can be reacted', async ({ authenticatedPage: page }) => {
    await openWith(page, [createAgentComment({ id: 38, issueId: ISSUE_ID })]);
    const posts = trackRequests(page, 'POST', REACTION_PATH);
    const item = page.locator('section[aria-label="코멘트"] ul li[data-agent="true"]');
    await item.hover();
    await page.getByTestId('comment-reaction-add-38').click();
    await page.getByTestId('comment-reaction-quick-38-🎉').click();
    await expect(page.getByTestId('comment-reaction-pill-38-🎉')).toHaveAttribute('aria-pressed', 'true');
    await posts.waitFor(1);
    expect(posts.lastUrl()?.pathname).toBe(`/api/v1/issues/${ISSUE_ID}/comments/38/reactions`);
  });

  test('reader sees read-only chips', async ({ authenticatedPage: page }) => {
    // 코멘트 작성 권한이 없는 사람(viewerCanEditContent=false) — 칩은 개수만 보이고 누를 수 없다. 반응자 호버 카드는 읽기라 뜬다.
    await openWith(
      page,
      [
        createComment({
          id: 41,
          issueId: ISSUE_ID,
          authorId: 2,
          body: '반응 있는 코멘트(읽기 전용)',
          reactions: [{ emoji: '👍', count: 2, reacted: false }],
        }),
        createComment({ id: 42, issueId: ISSUE_ID, authorId: 2, body: '반응 없는 코멘트(읽기 전용)' }),
      ],
      { detail: { viewerCanEditContent: false } },
    );
    await stubReactors(page, 41, { '👍': [{ userId: 3, name: '이영희' }, { userId: 4, name: '박지훈' }] });
    const writes = trackRequests(page, 'ANY', REACTION_PATH);
    // 마우스를 올려도 추가 버튼(＋/😊+)이 어디에도 없다.
    await commentItem(page, '반응 없는 코멘트(읽기 전용)').hover();
    await commentItem(page, '반응 있는 코멘트(읽기 전용)').hover();
    await expect(page.locator('[data-testid^="comment-reaction-add-"]')).toHaveCount(0);
    // 칩을 눌러도 요청이 나가지 않고 개수도 그대로.
    const pill = page.getByTestId('comment-reaction-pill-41-👍');
    await expect(pill).toBeDisabled();
    // 비활성 버튼은 Playwright click 이 기다리기만 하므로 click 이벤트를 직접 보낸다(실제 탭과 같이 무시돼야 한다).
    await pill.dispatchEvent('click');
    await expectStays(page, () => writes.count(), 0, { ms: 300 });
    await expect(page.getByTestId('comment-reaction-count-41-👍')).toHaveText('2');
    // 호버 카드는 뜬다(반응자 조회 = 이슈 읽기 권한).
    await pill.hover();
    await expect(page.getByTestId('reaction-hover-summary-41')).toHaveText('이영희, 박지훈이 반응했습니다');
  });

  test('edit keeps reactions', async ({ authenticatedPage: page }) => {
    const detailRef = await openWith(page, [
      createComment({
        id: 43,
        issueId: ISSUE_ID,
        authorId: ME_ID,
        body: '수정 전 내 코멘트',
        reactions: [
          { emoji: '👍', count: 2, reacted: true },
          { emoji: '🎉', count: 1, reacted: false },
        ],
      }),
    ]);
    // 수정(PATCH) stub — 서버처럼 본문만 바꾸고 반응 집계는 그대로 실어 돌려준다.
    const patches = trackRequests(page, 'PATCH', /\/api\/v1\/issues\/\d+\/comments\/43$/);
    await page.route(
      (url) => url.pathname === `/api/v1/issues/${ISSUE_ID}/comments/43`,
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const { body } = route.request().postDataJSON() as { body: string };
        const d = detailRef.current;
        detailRef.current = { ...d, comments: d.comments.map((c) => (c.id === 43 ? { ...c, body } : c)) };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detailRef.current.comments.find((c) => c.id === 43)),
        });
      },
    );
    await commentItem(page, '수정 전 내 코멘트').hover();
    await page.getByRole('button', { name: '코멘트 수정' }).click();
    const input = page.getByTestId('issue-comment-edit-input');
    await input.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('수정 후 내 코멘트');
    await page.getByTestId('issue-comment-edit-save').click();
    await patches.waitFor(1);
    await expect(page.getByText('수정 후 내 코멘트')).toBeVisible();
    // 수정 뒤에도 칩·개수·내 반응 강조가 그대로 남는다.
    await expect(page.getByTestId('comment-reaction-pill-43-👍')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('comment-reaction-count-43-👍')).toHaveText('2');
    await expect(page.getByTestId('comment-reaction-count-43-🎉')).toHaveText('1');
  });
});
