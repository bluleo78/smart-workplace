// 이슈 「관계」 그룹 E2E(WP-887) — 관계 추가 창에서 같은/다른 프로젝트 이슈와 관계를 걸고, 외부 링크(Jira 등)를 붙이고,
// 줄을 지우는 흐름을 상태 있는 모킹 서버(IssueRelationServer)로 검증한다. 차단 저장 경로는 dependencies.spec 이 맡는다.
// 검증 축: 입력 → POST payload(postDataJSON) → 반대쪽 이슈 상세에 말이 맞게 보임 → 오류 토스트/창 유지.
// 찾기 디바운스(250ms)는 page.clock 으로 넘긴다(고정 대기 없음).
import type { Page } from '@playwright/test';

import type { IssueLookupItem } from '../../../src/types/issue';
import { makeTaskType } from '../../factories/issueType.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { IssueRelationServer } from '../../fixtures/issueRelationServer';
import { trackRequests } from '../../fixtures/requests';

const KEY = 'WP';
const REL = `/api/v1/projects/${KEY}/issues/1/relations`;
const EXT = `/api/v1/projects/${KEY}/issues/1/external-links`;
const JIRA = 'https://iacloud.atlassian.net/browse/CL-1867';

const lookupItem = (projectKey: string, number: number, title: string): IssueLookupItem => ({
  projectKey, number, title, status: 'TODO', type: makeTaskType(),
});

/** 서버를 깔고 이슈 WP-1·WP-2 를 만든다. 시계는 goto 전에 설치해야 한다. */
async function setup(page: Page) {
  const server = new IssueRelationServer();
  server.addIssue('WP-1', '결제 모듈');
  server.addIssue('WP-2', '환불 처리');
  server.addIssue('WPV-28', '다른 프로젝트 이슈');
  await server.install(page);
  await page.clock.install();
  return server;
}

/** 이슈 상세를 열고 「관계」 그룹을 펼친다(기본 접힘). */
async function openIssue(page: Page, number = 1, key = KEY) {
  await page.goto(`/projects/${key}/issues/${number}`);
  // 펼침 상태는 localStorage 에 남아 두 번째 상세에선 이미 펼쳐져 있을 수 있다 — 접혀 있을 때만 누른다.
  const trigger = page.getByTestId('property-group-relations').getByRole('button', { name: /^관계(\s*\d+)?$/ });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(page.getByTestId('issue-relations-section')).toBeVisible();
}

/** 관계 추가 창을 열고 「이 이슈는…」 선택지(typeId:side)를 고른다. */
async function openDialog(page: Page, option: string) {
  await page.getByTestId('issue-relation-add').click();
  await expect(page.getByTestId('issue-relation-dialog')).toBeVisible();
  await page.getByTestId('issue-relation-type-select').click();
  await page.getByTestId(`issue-relation-option-${option}`).click();
}

/** 이슈 찾기 입력 → 디바운스를 시계로 넘긴다. */
async function search(page: Page, q: string) {
  await page.getByTestId('issue-relation-search').fill(q);
  await page.clock.fastForward(300);
}

test.describe('이슈 관계', () => {
  test('같은 프로젝트 「관련」 추가 → POST payload·찾기 쿼리 → 양쪽 상세에 「관련」', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem(KEY, 1, '결제 모듈'), lookupItem(KEY, 2, '환불 처리')];
    const posts = trackRequests(page, 'POST', REL);
    const lookups = trackRequests(page, 'GET', '/api/v1/issues/lookup');

    await openIssue(page);
    await expect(page.getByTestId('issue-relations-section')).toHaveText('없음');
    await openDialog(page, '2:source'); // 관련
    await search(page, '2');
    // 번호만 쳐도 그대로 묻고 현재 프로젝트를 from 으로 싣는다(서버가 이 프로젝트의 그 번호를 앞세운다). 자기 자신(#1)은 목록에서 빠진다.
    await expect.poll(() => lookups.lastUrl()?.searchParams.get('q')).toBe('2');
    expect(lookups.lastUrl()?.searchParams.get('from')).toBe(KEY);
    await expect(page.getByTestId('issue-relation-result-WP-2')).toBeVisible();
    await expect(page.getByTestId('issue-relation-result-WP-1')).toHaveCount(0);
    await page.getByTestId('issue-relation-result-WP-2').click();
    await expect(page.getByTestId('issue-relation-selected')).toContainText('#2 환불 처리');
    await page.getByTestId('issue-relation-submit').click();

    await expect.poll(() => posts.lastBody()).toEqual({ typeId: 2, side: 'source', target: { projectKey: KEY, number: 2 } });
    await expect(page.getByText('관계를 추가했습니다')).toBeVisible();
    await expect(page.getByTestId('issue-relation-dialog')).toHaveCount(0);
    const group = page.getByTestId('issue-relation-group-2-source');
    await expect(group).toContainText('환불 처리');
    await expect(group.getByTestId('issue-relation-row-100')).toContainText('#2');

    // 반대쪽(WP-2) 상세에도 같은 「관련」으로 WP-1 이 보인다.
    await openIssue(page, 2);
    await expect(page.getByTestId('issue-relation-group-2-source')).toContainText('결제 모듈');
    await expect(page.getByTestId('issue-relation-group-heading-2-source')).toHaveText('관련');
  });

  test('「원인임」 추가 → 상대 상세에 「결과임」, 활동 타임라인에 「관계 추가」', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')];
    const posts = trackRequests(page, 'POST', REL);
    const lookups = trackRequests(page, 'GET', '/api/v1/issues/lookup');

    await openIssue(page);
    await openDialog(page, '5:source'); // 원인임
    await search(page, '#2');
    // 「#2」 도 바꾸지 않고 그대로 묻는다 — 그 번호가 없으면 서버가 제목으로 찾는다.
    await expect.poll(() => lookups.lastUrl()?.searchParams.get('q')).toBe('#2');
    await page.getByTestId('issue-relation-result-WP-2').click();
    await page.getByTestId('issue-relation-submit').click();

    await expect.poll(() => posts.lastBody()).toEqual({ typeId: 5, side: 'source', target: { projectKey: KEY, number: 2 } });
    const mine = page.getByTestId('issue-relation-group-5-source');
    await expect(page.getByTestId('issue-relation-group-heading-5-source')).toHaveText('원인임');
    await expect(mine).toContainText('환불 처리');
    // 타임라인 — 이력 종류 라벨과 본문(말 + 「제목」(#키)).
    await page.getByRole('tab', { name: /이력/ }).click();
    const timeline = page.getByTestId('issue-activity-timeline');
    await expect(timeline).toContainText('관계 추가');
    await expect(timeline).toContainText('원인임 「환불 처리」(#2)');

    await openIssue(page, 2);
    const theirs = page.getByTestId('issue-relation-group-5-target');
    await expect(page.getByTestId('issue-relation-group-heading-5-target')).toHaveText('결과임');
    await expect(theirs).toContainText('결제 모듈');
  });

  test('B 쪽 말(「결과임」)로 추가하면 side=target 으로 저장되고 상대에겐 「원인임」', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')];
    const posts = trackRequests(page, 'POST', REL);

    await openIssue(page);
    await openDialog(page, '5:target'); // 결과임
    await search(page, '2');
    await page.getByTestId('issue-relation-result-WP-2').click();
    await page.getByTestId('issue-relation-submit').click();

    await expect.poll(() => posts.lastBody()).toEqual({ typeId: 5, side: 'target', target: { projectKey: KEY, number: 2 } });
    await expect(page.getByTestId('issue-relation-group-5-target')).toContainText('환불 처리');
    await openIssue(page, 2);
    await expect(page.getByTestId('issue-relation-group-5-source')).toContainText('결제 모듈');
  });

  test('다른 프로젝트 이슈를 키로 찾아 추가 → 「WPV-28」 표시, 링크로 그 이슈 상세로 이동', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem('WPV', 28, '다른 프로젝트 이슈')];
    const posts = trackRequests(page, 'POST', REL);
    const lookups = trackRequests(page, 'GET', '/api/v1/issues/lookup');

    await openIssue(page);
    await openDialog(page, '2:source');
    await search(page, 'WPV-28');
    await expect.poll(() => lookups.lastUrl()?.searchParams.get('q')).toBe('WPV-28');
    await page.getByTestId('issue-relation-result-WPV-28').click();
    await expect(page.getByTestId('issue-relation-selected')).toContainText('WPV-28');
    await page.getByTestId('issue-relation-submit').click();

    await expect.poll(() => posts.lastBody()).toEqual({ typeId: 2, side: 'source', target: { projectKey: 'WPV', number: 28 } });
    const row = page.getByTestId('issue-relation-group-2-source').getByTestId('issue-relation-row-100');
    await expect(row).toContainText('WPV-28');
    const link = row.getByRole('link', { name: /다른 프로젝트 이슈/ });
    await expect(link).toHaveAttribute('href', '/projects/WPV/issues/28');
    await link.click();
    await expect(page).toHaveURL(/\/projects\/WPV\/issues\/28$/);
    await expect(page.getByTestId('issue-title-heading')).toContainText('다른 프로젝트 이슈');
  });

  test('이미 있는 관계(409) → 오류 토스트, 창과 고른 이슈는 그대로', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')];
    server.failNextRelationPost = { status: 409, code: 'ISSUE_RELATION_EXISTS', message: '이미 같은 관계가 있습니다' };
    const posts = trackRequests(page, 'POST', REL);

    await openIssue(page);
    await openDialog(page, '2:source');
    await search(page, '2');
    await page.getByTestId('issue-relation-result-WP-2').click();
    await page.getByTestId('issue-relation-submit').click();

    await expect(page.getByText('이미 같은 관계가 있습니다')).toBeVisible();
    expect(posts.count()).toBe(1);
    await expect(page.getByTestId('issue-relation-dialog')).toBeVisible();
    await expect(page.getByTestId('issue-relation-selected')).toContainText('#2 환불 처리');
    await expect(page.getByTestId('issue-relation-submit')).toBeEnabled();
    // 목록엔 추가되지 않았다(저장 안 됨).
    expect(server.relations).toHaveLength(0);
  });

  test('줄 제거 → DELETE 경로 + 양쪽 상세에서 사라짐', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')];
    // 서버에 미리 걸려 있는 관계 — 화면을 거치지 않고 시드한다(추가 흐름은 위 테스트가 본다).
    server.relations.push({ id: 7, typeId: 2, source: { projectKey: KEY, number: 1 }, target: { projectKey: KEY, number: 2 } });
    const deletes = trackRequests(page, 'DELETE', `${REL}/7`);

    await openIssue(page);
    const row = page.getByTestId('issue-relation-row-7');
    await expect(row).toContainText('환불 처리');
    await row.hover();
    await page.getByTestId('issue-relation-remove-7').click();

    await deletes.waitFor();
    await expect(page.getByText('관계를 제거했습니다')).toBeVisible();
    await expect(page.getByTestId('issue-relation-row-7')).toHaveCount(0);
    await expect(page.getByTestId('issue-relations-section')).toHaveText('없음');
    await openIssue(page, 2);
    await expect(page.getByTestId('issue-relations-section')).toHaveText('없음');
  });

  test('편집 권한이 없으면 「＋ 관계 추가」·제거 버튼이 없고 관계는 읽기만 된다', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.viewerCanEditWorkflow = false;
    server.relations.push({ id: 7, typeId: 2, source: { projectKey: KEY, number: 1 }, target: { projectKey: KEY, number: 2 } });

    await page.goto(`/projects/${KEY}/issues/1`);
    await page.getByTestId('property-group-relations').getByRole('button', { name: /^관계(\s*\d+)?$/ }).click();
    await expect(page.getByTestId('issue-relation-row-7')).toContainText('환불 처리');
    await expect(page.getByTestId('issue-relation-add')).toHaveCount(0);
    await expect(page.getByTestId('issue-relation-remove-7')).toHaveCount(0);
  });
});

test.describe('외부 링크', () => {
  test('Jira 주소를 붙이면 키가 채워지고 「에픽에 속함」으로 추가 → 새 탭 링크, 수정, 제거', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    const posts = trackRequests(page, 'POST', EXT);
    const puts = trackRequests(page, 'PUT', (u) => u.pathname.startsWith(`${EXT}/`));
    const deletes = trackRequests(page, 'DELETE', (u) => u.pathname.startsWith(`${EXT}/`));

    await openIssue(page);
    // 에픽에 속함은 외부 전용이라 이슈 탭엔 없다 — 외부 링크 탭으로 바꾼 뒤 고른다.
    await page.getByTestId('issue-relation-add').click();
    await page.getByTestId('issue-relation-tab-external').click();
    await page.getByTestId('issue-relation-type-select').click();
    await page.getByTestId('issue-relation-option-6:source').click();
    await page.getByTestId('issue-relation-url').fill(JIRA);
    // 키는 주소에서 자동으로 채워진다.
    await expect(page.getByTestId('issue-relation-key')).toHaveValue('CL-1867');
    await page.getByTestId('issue-relation-title').fill('v1.7.0 버그 픽스 및 이슈 대응');
    await page.getByTestId('issue-relation-submit').click();

    await expect.poll(() => posts.lastBody()).toEqual({
      typeId: 6, side: 'source', url: JIRA, key: 'CL-1867', title: 'v1.7.0 버그 픽스 및 이슈 대응',
    });
    await expect(page.getByText('외부 링크를 추가했습니다')).toBeVisible();
    const id = server.externals[0].id;
    const row = page.getByTestId(`issue-external-link-row-${id}`);
    await expect(row).toContainText('에픽에 속함');
    await expect(row).toContainText('CL-1867');
    const open = page.getByTestId(`issue-external-link-open-${id}`);
    await expect(open).toHaveAttribute('href', JIRA);
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(open).toHaveAttribute('rel', /noopener/);

    // 수정 — 주소는 잠기고 제목만 바꾼다. 처음 선택지가 서버가 준 쪽이라 그 쪽을 그대로 보낸다.
    await row.hover();
    await page.getByTestId(`issue-external-link-edit-${id}`).click();
    await expect(page.getByTestId('issue-relation-url')).toBeDisabled();
    await page.getByTestId('issue-relation-title').fill('v1.7.1 대응');
    await page.getByTestId('issue-relation-submit').click();
    await expect.poll(() => puts.lastBody()).toEqual({ typeId: 6, side: 'source', key: 'CL-1867', title: 'v1.7.1 대응' });
    await expect(row).toContainText('v1.7.1 대응');

    // 제거
    await row.hover();
    await page.getByTestId(`issue-external-link-remove-${id}`).click();
    await deletes.waitFor();
    expect(deletes.lastUrl()?.pathname).toBe(`${EXT}/${id}`);
    await expect(row).toHaveCount(0);
  });

  test('주소·제목이 잘못되면 보내지 않고 오류 문구를 보인다', async ({ authenticatedPage: page }) => {
    await setup(page);
    const posts = trackRequests(page, 'POST', EXT);

    await openIssue(page);
    await page.getByTestId('issue-relation-add').click();
    await page.getByTestId('issue-relation-tab-external').click();
    await page.getByTestId('issue-relation-submit').click();
    await expect(page.getByText('주소를 입력해 주세요')).toBeVisible();
    await expect(page.getByText('제목을 입력해 주세요')).toBeVisible();

    await page.getByTestId('issue-relation-url').fill('ftp://example.com/x');
    await expect(page.getByText('http:// 또는 https:// 로 시작하는 주소를 입력해 주세요')).toBeVisible();
    expect(posts.count()).toBe(0);
    await expect(page.getByTestId('issue-relation-dialog')).toBeVisible();
  });
});

test.describe('관계 추가 창 — 차단·Enter', () => {
  test('「차단 중」을 고르면 다른 프로젝트 찾기 결과는 응답에 있어도 보이지 않는다', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem(KEY, 3, '같은 프로젝트'), lookupItem('WPV', 9, '다른 프로젝트')];

    await openIssue(page);
    await openDialog(page, '1:source'); // 차단 중
    await expect(page.getByTestId('issue-relation-results')).toContainText('차단은 이 프로젝트 이슈와만 걸 수 있어요.');
    await search(page, 'WP');
    await expect(page.getByTestId('issue-relation-result-WP-3')).toBeVisible();
    await expect(page.getByTestId('issue-relation-result-WPV-9')).toHaveCount(0);

    // 같은 응답이라도 「관련」으로 바꾸면 다른 프로젝트 결과가 보인다 — 거름은 차단일 때만.
    await page.getByTestId('issue-relation-type-select').click();
    await page.getByTestId('issue-relation-option-2:source').click();
    await expect(page.getByTestId('issue-relation-result-WPV-9')).toBeVisible();
  });

  test('「관련」으로 다른 프로젝트 이슈를 고른 뒤 「차단 중」으로 바꾸면 고른 이슈가 풀린다', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem(KEY, 3, '같은 프로젝트'), lookupItem('WPV', 9, '다른 프로젝트')];

    await openIssue(page);
    await openDialog(page, '2:source');
    await search(page, 'WP');
    await page.getByTestId('issue-relation-result-WPV-9').click();
    await expect(page.getByTestId('issue-relation-selected')).toContainText('WPV-9');
    await expect(page.getByTestId('issue-relation-submit')).toBeEnabled();

    await page.getByTestId('issue-relation-type-select').click();
    await page.getByTestId('issue-relation-option-1:source').click();
    await expect(page.getByTestId('issue-relation-selected')).toHaveText('목록에서 이슈를 하나 고르세요.');
    await expect(page.getByTestId('issue-relation-submit')).toBeDisabled();

    // 같은 프로젝트 이슈를 고르는 건 된다.
    await page.getByTestId('issue-relation-result-WP-3').click();
    await expect(page.getByTestId('issue-relation-submit')).toBeEnabled();
  });

  test('찾기 입력에서 Enter → 고른 이슈가 있으면 한 번만 추가(WP-852), 없으면 아무것도 보내지 않는다', async ({ authenticatedPage: page }) => {
    const server = await setup(page);
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')];
    const posts = trackRequests(page, 'POST', REL);

    await openIssue(page);
    await openDialog(page, '2:source');
    await search(page, '2');
    await expect(page.getByTestId('issue-relation-result-WP-2')).toBeVisible();
    // 고르기 전 Enter — 요청 없음, 창 유지.
    await page.getByTestId('issue-relation-search').press('Enter');
    await expect(page.getByTestId('issue-relation-dialog')).toBeVisible();
    expect(posts.count()).toBe(0);

    await page.getByTestId('issue-relation-result-WP-2').click();
    await page.getByTestId('issue-relation-search').focus();
    await page.getByTestId('issue-relation-search').press('Enter');
    await expect.poll(() => posts.lastBody()).toEqual({ typeId: 2, side: 'source', target: { projectKey: KEY, number: 2 } });
    await expect(page.getByTestId('issue-relation-dialog')).toHaveCount(0);
    await expect(page.getByTestId('issue-relation-group-2-source')).toContainText('환불 처리');
    // 새 줄이 그려진 뒤에도 요청은 한 번뿐이다(Enter 가 두 번 보내지 않는다).
    await expect.poll(() => posts.count()).toBe(1);
  });
});
