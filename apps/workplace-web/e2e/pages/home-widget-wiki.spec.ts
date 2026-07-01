// #460: 홈 챗 도크 위키 위젯 렌더 — show_wiki / show_wiki_page 지시를 받아
// 스페이스·페이지 목록(WikiWidget)과 페이지 상세(WikiPageWidget)를 렌더하는지 검증한다.
// 전략: compose done SSE 에 widgets:[{type:'wiki',...}] 를 포함시키고
//   위젯이 자체 훅으로 호출하는 /wiki/spaces, /wiki/spaces/:id/pages, /wiki/pages/:id 를
//   모킹하여 백엔드 없이 검증한다.

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../factories/wiki.factory'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('#460 홈 챗 도크 위키 위젯 렌더', () => {
  test(
    'wiki 위젯이 스페이스 목록을 렌더한다 (spaceId 없음)',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 1) compose → wiki 위젯(spaceId 없음) 지시.
      await page.route(
        (url) => url.pathname === '/api/v1/ai/chat',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: done\ndata: {"sessionId":"s-wiki-1","widgets":[{"type":"wiki","params":{}}]}\n\n',
          }),
      )
      // 2) 스페이스 목록 API 모킹.
      await page.route(
        (url) => url.pathname === '/api/v1/wiki/spaces',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              wikiSpace({ id: 1, name: '팀 위키' }),
              wikiSpace({ id: 2, name: '개인 노트', type: 'PERSONAL' }),
            ]),
          }),
      )

      await page.goto('/')
      await page.getByTestId('chat-launcher').click()
      await page.getByTestId('chat-input').fill('위키 보여줘')
      await page.getByRole('button', { name: '보내기' }).click()

      // 출력: 위젯 컨테이너 + 스페이스 목록.
      await expect(page.getByTestId('chat-widgets')).toBeVisible()
      const items = page.getByTestId('wiki-items')
      await expect(items).toBeVisible()
      await expect(items).toContainText('팀 위키')
      await expect(items).toContainText('개인 노트')
    },
  )

  test('wiki 위젯이 spaceId 있을 때 페이지 목록을 렌더한다', async ({ authenticatedPage: page }) => {
    // compose → wiki 위젯(spaceId=1) 지시.
    await page.route(
      (url) => url.pathname === '/api/v1/ai/chat',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-wiki-2","widgets":[{"type":"wiki","params":{"spaceId":1}}]}\n\n',
        }),
    )
    // 페이지 트리 API 모킹.
    await page.route(
      (url) => url.pathname === '/api/v1/wiki/spaces/1/pages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            wikiPageSummary({ id: 101, title: '온보딩 가이드' }),
            wikiPageSummary({ id: 102, title: '개발 환경 설정' }),
          ]),
        }),
    )

    await page.goto('/')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('chat-input').fill('팀 위키 페이지 보여줘')
    await page.getByRole('button', { name: '보내기' }).click()

    await expect(page.getByTestId('chat-widgets')).toBeVisible()
    const items = page.getByTestId('wiki-items')
    await expect(items).toBeVisible()
    await expect(items).toContainText('온보딩 가이드')
    await expect(items).toContainText('개발 환경 설정')
  })

  test('wiki 위젯이 스페이스 없으면 빈 상태를 표시한다', async ({ authenticatedPage: page }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/ai/chat',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-wiki-3","widgets":[{"type":"wiki","params":{}}]}\n\n',
        }),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/wiki/spaces',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
    )

    await page.goto('/')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('chat-input').fill('위키 보여줘')
    await page.getByRole('button', { name: '보내기' }).click()

    await expect(page.getByTestId('chat-widgets')).toBeVisible()
    await expect(page.getByTestId('wiki-empty')).toBeVisible()
    await expect(page.getByTestId('wiki-empty')).toContainText('노트가 없어요')
  })

  test(
    'wiki_page 위젯이 페이지 상세를 렌더한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // compose → wiki_page 위젯(pageId=101) 지시.
      await page.route(
        (url) => url.pathname === '/api/v1/ai/chat',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: done\ndata: {"sessionId":"s-wiki-4","widgets":[{"type":"wiki_page","params":{"pageId":101}}]}\n\n',
          }),
      )
      // 페이지 상세 API 모킹.
      await page.route(
        (url) => url.pathname === '/api/v1/wiki/pages/101',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              wikiPageDetail({
                id: 101,
                title: '온보딩 가이드',
                body: '# 온보딩\n신규 입사자를 위한 안내 문서입니다.',
              }),
            ),
          }),
      )

      await page.goto('/')
      await page.getByTestId('chat-launcher').click()
      await page.getByTestId('chat-input').fill('온보딩 가이드 페이지 상세 보여줘')
      await page.getByRole('button', { name: '보내기' }).click()

      await expect(page.getByTestId('chat-widgets')).toBeVisible()
      const detail = page.getByTestId('wiki_page-detail')
      await expect(detail).toBeVisible()
      await expect(detail).toContainText('온보딩 가이드')
      await expect(detail).toContainText('신규 입사자를 위한 안내')
    },
  )

  test('wiki_page 위젯 pageId 누락 시 안내 메시지를 표시한다', async ({ authenticatedPage: page }) => {
    // compose → wiki_page 위젯(pageId 없음) 지시.
    await page.route(
      (url) => url.pathname === '/api/v1/ai/chat',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-wiki-5","widgets":[{"type":"wiki_page","params":{}}]}\n\n',
        }),
    )

    await page.goto('/')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('chat-input').fill('위키 페이지 상세 보여줘')
    await page.getByRole('button', { name: '보내기' }).click()

    await expect(page.getByTestId('chat-widgets')).toBeVisible()
    const error = page.getByTestId('wiki_page-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('페이지 ID가 없습니다')
  })
})
