// 모바일 노트 트리 행 액션(WP-237) — 페이지 테스트(WP-981).
// 휴대폰에선 hover ＋·⋯ 대신 ⋯ 하나 → 액션 시트이고, 시트의 하위 페이지 추가(POST parentId)·삭제(확인 뒤 DELETE)가 보내는 요청은
// 브라우저 없이 판정되므로 e2e/pages/mobile/wiki-tree-actions.spec.ts 에서 옮겼다. ⋯ 44px·제목과의 배치·가로 넘침(@layout)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'

mockViewport()

const SPACE = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })
const TITLE = '긴 제목의 개인 메모 페이지가 한 줄을 넘어가는 경우'

/** 공간 1개·페이지 1개 트리 — 생성 본문·삭제 경로를 모은다. */
function open() {
  const creates: unknown[] = []
  const deletes: string[] = []
  const page = renderPage('/wiki/spaces/1', {
    handlers: [
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json([SPACE])),
      http.get('/api/v1/wiki/spaces/1/pages', () => HttpResponse.json([wikiPageSummary({ id: 101, title: TITLE })])),
      http.post('/api/v1/wiki/spaces/1/pages', async ({ request }) => {
        creates.push(await request.json())
        return HttpResponse.json(wikiPageDetail({ id: 300, spaceId: 1, parentId: 101, title: '', body: '' }))
      }),
      http.get('/api/v1/wiki/pages/:id', ({ params }) => HttpResponse.json(wikiPageDetail({ id: Number(params.id), spaceId: 1, title: '개인 메모' }))),
      http.delete('/api/v1/wiki/pages/:id', ({ request }) => {
        deletes.push(new URL(request.url).pathname)
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  return { ...page, creates, deletes }
}

/** 모바일 목록의 101 행 ⋯ 를 눌러 시트를 연다. hover 용 「하위 페이지」 버튼은 없다. */
async function openSheet(user: ReturnType<typeof renderPage>['user']) {
  const list = await screen.findByTestId('mobile-module-list', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const row = await within(list).findByTestId('wiki-tree-row-101', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(within(row).queryByRole('button', { name: '하위 페이지' })).not.toBeInTheDocument()
  await user.click(within(row).getByRole('button', { name: /페이지 메뉴$/ }))
  return screen.findByTestId('wiki-tree-action-sheet')
}

test('시트의 하위 페이지 추가 → POST { parentId: 101, title: "" }', async () => {
  const { user, creates } = open()
  const sheet = await openSheet(user)
  await user.click(within(sheet).getByTestId('mobile-action-wiki-add-child'))
  await waitFor(() => expect(creates).toEqual([{ parentId: 101, title: '' }]))
})

test('시트의 삭제 → 확인 다이얼로그 → DELETE', async () => {
  const { user, deletes } = open()
  const sheet = await openSheet(user)
  await user.click(within(sheet).getByTestId('mobile-action-wiki-delete'))
  await user.click(within(await screen.findByTestId('wiki-delete-dialog')).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(deletes).toEqual(['/api/v1/wiki/pages/101']))
})
