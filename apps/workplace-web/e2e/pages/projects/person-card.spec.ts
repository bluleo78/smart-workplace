// 사람 카드 E2E (WP-1767) — 브라우저가 있어야 판정되는 두 가지만 남긴다.
//  - @layout: 390px 에서 코멘트 작성자 이름을 누르면 아래 시트로 열리고, 단추 셋이 한 줄이며 시트를 넘지 않는다.
//  - @input: 데스크톱에서 Tab → Enter 로 열고, 첫 단추로 포커스가 가며, Esc 로 닫히면 포커스가 이름으로 돌아온다.
// 카드 내용(문구·분기·이동)은 vitest(PersonCard*.test.tsx, issueDetailPersonCard.test.tsx)가 지킨다.

import { expect, test } from '../../fixtures/auth.fixture';
import { mailAccount } from '../../factories/mail.factory';
import { createComment, createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { Page } from '@playwright/test';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
// auth fixture 의 ME(id 1)와 다른 사람 — 본인이면 카드가 「내 프로필」 단추 하나뿐이다.
const AUTHOR_ID = 2;
const AUTHOR_NAME = '김지우';

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// 이슈 상세 + 사람 카드가 받는 API(프로필·연락처·메일 계정)를 모킹한다. 작성자가 한 명인 코멘트 1건.
async function mockIssueWithComment(page: Page) {
  const base = `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`;
  const comment = createComment({ id: 10, authorId: AUTHOR_ID, authorName: AUTHOR_NAME, body: '확인했습니다' });
  const detail = createIssueDetail({ summary: createIssue({ projectKey: PROJECT_KEY, number: ISSUE_NUMBER }), comments: [comment] });

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (r) => r.fulfill(json(createProject({ key: PROJECT_KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/members`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === base, (r) => r.fulfill(json(detail)));
  for (const sub of ['watchers', 'labels', 'attachments', 'drive-links']) {
    await page.route((u) => u.pathname === `${base}/${sub}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `${base}/chat/thread`, (r) =>
    r.fulfill(json({ threadId: 999, unreadCount: 0, recentMessages: [] })));
  // 사람 카드가 열릴 때 받는 것들.
  await page.route((u) => u.pathname === `/api/v1/members/${AUTHOR_ID}`, (r) =>
    r.fulfill(json({
      userId: AUTHOR_ID, username: 'jiwoo', name: AUTHOR_NAME, email: 'jiwoo@example.com', title: '디자이너',
      kind: 'HUMAN', active: true, membershipRole: 'MEMBER', membershipStatus: 'ACTIVE',
    })));
  await page.route((u) => u.pathname === `/api/v1/contacts/members/${AUTHOR_ID}`, (r) =>
    r.fulfill(json({ userId: AUTHOR_ID, name: AUTHOR_NAME, groups: ['디자인팀'] })));
  await page.route((u) => u.pathname === '/api/v1/mail/accounts', (r) => r.fulfill(json([mailAccount()])));
}

test.describe('사람 카드 — 모바일 시트', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390px 에서 작성자 이름을 누르면 아래 시트로 열리고 단추 셋이 한 줄이다', async ({ authenticatedPage: page }) => {
    await mockIssueWithComment(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await page.getByTestId(`person-card-trigger-${AUTHOR_ID}`).click();

    const sheet = page.getByTestId('person-card-sheet');
    const card = page.getByTestId('person-card');
    await expect(card).toBeVisible();
    // 단추 셋이 모두 나타난 뒤(프로필 응답 → 단추 표시)에 기하를 잰다.
    const buttons = ['메시지', '메일 쓰기', '일정 잡기'].map((name) => card.getByRole('button', { name }));
    for (const b of buttons) await expect(b).toBeVisible();

    const sheetBox = await sheet.boundingBox();
    const viewport = page.viewportSize();
    expect(sheetBox).not.toBeNull();
    // 아래 시트 — 화면 아래에 붙고 폭은 화면을 채운다.
    expect(sheetBox!.y + sheetBox!.height).toBeGreaterThan(viewport!.height - 2);
    expect(sheetBox!.y).toBeGreaterThan(0);

    const boxes = [];
    for (const b of buttons) boxes.push((await b.boundingBox())!);
    // 같은 y(한 줄) + 시트 오른쪽을 넘지 않음.
    for (const box of boxes) {
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
      expect(box.x + box.width).toBeLessThanOrEqual(sheetBox!.x + sheetBox!.width + 0.5);
    }

    // 문서 가로 스크롤 없음.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('사람 카드 — 키보드', { tag: '@input' }, () => {
  test('이름에 Tab 으로 포커스 → Enter 로 열림 → 첫 단추 포커스 → Esc 로 닫히면 이름으로 돌아온다', async ({ authenticatedPage: page }) => {
    await mockIssueWithComment(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const trigger = page.getByTestId(`person-card-trigger-${AUTHOR_ID}`);
    await expect(trigger).toBeVisible();
    // Tab 으로 이름까지 이동 — 앞쪽 포커스 가능한 요소 수에 기대지 않고 도착할 때까지 누른다.
    for (let i = 0; i < 60; i++) {
      if (await trigger.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    const card = page.getByTestId('person-card');
    await expect(card).toBeVisible();
    // 카드 안 첫 단추(메시지)로 포커스가 옮겨진다.
    await expect(card.getByRole('button', { name: '메시지' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
