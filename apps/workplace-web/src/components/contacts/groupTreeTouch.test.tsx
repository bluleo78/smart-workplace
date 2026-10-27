// 터치 태블릿(≥1024px, pointer: coarse) 연락처 그룹 행 액션(WP-237) — 화면 테스트(WP-971, WP-995, WP-966).
// hover 아이콘 대신 ⋯ 드롭다운으로 모인 항목·파괴 표시, 삭제가 확인 창을 거쳐 DELETE 되는 것, 내 그룹 ⋯ → 수정 → PATCH 본문은
// 브라우저 없이 판정되므로 e2e/pages/contacts/contacts-touch-actions.spec.ts 에서 옮겼다.
// ⋯ 의 44px 터치 크기(@layout)와 안 보이는 ★ 탭 무시(@input)는 그 E2E 에 남는다. 휴대폰 폭(액션 시트)은 mobileContactsTouchActions.test.tsx.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { ADMIN, record, type Recorded, renderContacts } from '@/pages/contacts/testkit-b8'
import { mockViewport } from '@/test/viewport'

import { page as makePage } from '../../../e2e/factories/contacts.factory'
import { personalDetail, sharedDetail, tree } from '../../../e2e/factories/userGroups.factory'

// E2E 와 같은 터치 태블릿(1180×820, coarse) — matchMedia 결과가 파일 안에서 캐시되므로 첫 렌더 전에 한 번.
mockViewport({ width: 1180, height: 820, pointer: 'coarse' })

const base = [
  http.get('/api/v1/contacts', () => HttpResponse.json(makePage([]))),
  http.get('/api/v1/user-groups', () => HttpResponse.json(tree())),
  http.get('/api/v1/user-groups/10', () => HttpResponse.json(sharedDetail())),
  http.get('/api/v1/user-groups/20', () => HttpResponse.json(personalDetail())),
]

// 관리자 조직도 노드 — hover 아이콘 묶음은 그리지 않고 ⋯ 드롭다운에 하위 추가·수정·삭제(파괴 표시)가 모인다. 삭제는 확인 창을 거친다.
test('조직도 노드: hover 아이콘 대신 ⋯ 드롭다운 → 삭제 확인 → DELETE', async () => {
  let deletes = 0
  const { user } = renderContacts('/contacts?group=10', {
    auth: ADMIN,
    handlers: [
      http.delete('/api/v1/user-groups/10', () => {
        deletes++
        return new HttpResponse(null, { status: 204 })
      }),
      ...base,
    ],
  })
  const more = await screen.findByTestId('org-more-10')
  expect(screen.queryByTestId('org-edit-10')).not.toBeInTheDocument()
  await user.click(more)
  expect(await screen.findByTestId('org-add-10')).toBeInTheDocument()
  expect(screen.getByTestId('org-edit-10')).toBeInTheDocument()
  const del = screen.getByTestId('org-delete-10')
  expect(del).toHaveAttribute('data-variant', 'destructive')
  await user.click(del)
  expect(await screen.findByTestId('org-delete-confirm')).toBeInTheDocument()
  expect(deletes).toBe(0)
  await user.click(screen.getByTestId('org-delete-confirm-btn'))
  await waitFor(() => expect(deletes).toBe(1))
})

// 내 그룹 — 수정·삭제 아이콘 대신 ⋯ → 수정 → 폼 저장이 PATCH 로 나간다.
test('내 그룹: ⋯ 드롭다운 → 수정 → PATCH 본문', async () => {
  const patches: Recorded[] = []
  const { user } = renderContacts('/contacts', {
    handlers: [
      http.patch('/api/v1/user-groups/20', async ({ request }) => {
        await record(patches, request)
        return HttpResponse.json(personalDetail({ name: '내 분류(수정)' }))
      }),
      ...base,
    ],
  })
  await screen.findByTestId('group-node-20')
  expect(screen.queryByTestId('group-edit-20')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('group-more-20'))
  await user.click(await screen.findByTestId('group-edit-20'))
  await screen.findByTestId('group-form-dialog')
  fireEvent.change(screen.getByTestId('g-name'), { target: { value: '내 분류(수정)' } })
  await user.click(screen.getByTestId('g-save'))
  await waitFor(() => expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument())
  expect(patches[0].body).toMatchObject({ name: '내 분류(수정)' })
})
