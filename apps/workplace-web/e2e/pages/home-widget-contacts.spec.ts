// #460: 홈 챗 도크 연락처 위젯 렌더 — show_contacts / show_contact 지시를 받아
// 연락처 목록(ContactsWidget)과 상세(ContactWidget)를 렌더하는지 검증한다.
// 전략: compose done SSE 에 widgets:[{type:'contacts',...}] / [{type:'contact',...}] 를 포함시키고
//   위젯이 자체 훅으로 호출하는 /contacts, /contacts/external/:id 를 모킹하여 백엔드 없이 검증한다.

import { external, externalDetail, member, page } from '../factories/contacts.factory'
import { expect, test } from '../fixtures/auth.fixture'
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock'

test.describe('#460 홈 챗 도크 연락처 위젯 렌더', () => {
  test(
    'contacts 위젯이 연락처 목록을 렌더한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: pg }) => {
      // 1) compose → contacts 위젯(필터 없음) 지시.
      await mockHomeChatGeneration(pg, {
        frames: [
          { event: 'done', data: { sessionId: 's-contacts-1', widgets: [{ type: 'contacts', params: {} }] } },
        ],
      })
      // 2) 연락처 목록 API 모킹 — ContactPage(첫 페이지, nextCursor null).
      await pg.route(
        (url) => url.pathname === '/api/v1/contacts',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              page([
                member({ id: 1, name: '김멤버', email: 'kim@example.com', organization: null, title: '팀장' }),
                external({ id: 100, name: '박외부', email: 'park@corp.com', organization: 'Corp', title: null }),
              ]),
            ),
          }),
      )

      await pg.goto('/')
      await pg.getByTestId('chat-launcher').click()
      await pg.getByTestId('chat-input').fill('연락처 보여줘')
      await pg.getByRole('button', { name: '보내기' }).click()

      // 출력: 위젯 컨테이너 + 연락처 목록.
      await expect(pg.getByTestId('chat-widgets')).toBeVisible()
      const items = pg.getByTestId('contacts-items')
      await expect(items).toBeVisible()
      await expect(items).toContainText('김멤버')
      await expect(items).toContainText('박외부')
      await expect(items).toContainText('kim@example.com')
      await expect(items).toContainText('Corp')
    },
  )

  test('contacts 위젯이 필터 파라미터를 API 쿼리로 전달한다', async ({ authenticatedPage: pg }) => {
    // compose → contacts 위젯(search+org 필터) 지시.
    await mockHomeChatGeneration(pg, {
      frames: [
        { event: 'done', data: { sessionId: 's-contacts-2', widgets: [{ type: 'contacts', params: { search: '박', org: 'Corp' } }] } },
      ],
    })

    // 쿼리 파라미터 캡처용.
    let capturedUrl = ''
    await pg.route(
      (url) => url.pathname === '/api/v1/contacts',
      (route) => {
        capturedUrl = route.request().url()
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            page([external({ id: 100, name: '박외부', organization: 'Corp' })]),
          ),
        })
      },
    )

    await pg.goto('/')
    await pg.getByTestId('chat-launcher').click()
    await pg.getByTestId('chat-input').fill('Corp 연락처 검색')
    await pg.getByRole('button', { name: '보내기' }).click()

    await expect(pg.getByTestId('contacts-items')).toBeVisible()
    // 필터가 API 쿼리 파라미터로 전달됐는지 검증.
    const params = new URL(capturedUrl).searchParams
    expect(params.get('search')).toBe('박')
    expect(params.get('organization')).toBe('Corp')
  })

  test('contacts 위젯이 결과 없으면 빈 상태를 표시한다', async ({ authenticatedPage: pg }) => {
    await mockHomeChatGeneration(pg, {
      frames: [
        { event: 'done', data: { sessionId: 's-contacts-3', widgets: [{ type: 'contacts', params: {} }] } },
      ],
    })
    await pg.route(
      (url) => url.pathname === '/api/v1/contacts',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(page([])),
        }),
    )

    await pg.goto('/')
    await pg.getByTestId('chat-launcher').click()
    await pg.getByTestId('chat-input').fill('연락처 보여줘')
    await pg.getByRole('button', { name: '보내기' }).click()

    await expect(pg.getByTestId('chat-widgets')).toBeVisible()
    await expect(pg.getByTestId('contacts-empty')).toBeVisible()
    await expect(pg.getByTestId('contacts-empty')).toContainText('연락처가 없어요')
  })

  test(
    'contact 위젯이 외부 연락처 상세를 렌더한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: pg }) => {
      // compose → contact 위젯(contactId=100) 지시.
      await mockHomeChatGeneration(pg, {
        frames: [
          { event: 'done', data: { sessionId: 's-contacts-4', widgets: [{ type: 'contact', params: { contactId: 100 } }] } },
        ],
      })
      // 외부 연락처 상세 API 모킹.
      await pg.route(
        (url) => url.pathname === '/api/v1/contacts/external/100',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              externalDetail({
                id: 100,
                name: '박외부',
                email: 'park@corp.com',
                phone: '010-1234-5678',
                organization: 'Corp',
                title: '이사',
                notes: '중요 거래처',
              }),
            ),
          }),
      )

      await pg.goto('/')
      await pg.getByTestId('chat-launcher').click()
      await pg.getByTestId('chat-input').fill('박외부 연락처 상세 보여줘')
      await pg.getByRole('button', { name: '보내기' }).click()

      await expect(pg.getByTestId('chat-widgets')).toBeVisible()
      const detail = pg.getByTestId('contact-detail')
      await expect(detail).toBeVisible()
      await expect(detail).toContainText('박외부')
      await expect(detail).toContainText('park@corp.com')
      await expect(detail).toContainText('010-1234-5678')
      await expect(detail).toContainText('Corp')
      await expect(detail).toContainText('이사')
    },
  )

  test('contact 위젯 contactId 누락 시 안내 메시지를 표시한다', async ({ authenticatedPage: pg }) => {
    // compose → contact 위젯(contactId 없음) 지시.
    await mockHomeChatGeneration(pg, {
      frames: [
        { event: 'done', data: { sessionId: 's-contacts-5', widgets: [{ type: 'contact', params: {} }] } },
      ],
    })

    await pg.goto('/')
    await pg.getByTestId('chat-launcher').click()
    await pg.getByTestId('chat-input').fill('연락처 상세 보여줘')
    await pg.getByRole('button', { name: '보내기' }).click()

    await expect(pg.getByTestId('chat-widgets')).toBeVisible()
    const error = pg.getByTestId('contact-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('연락처 ID가 없습니다')
  })
})
