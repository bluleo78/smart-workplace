// 드라이브 팀 공간 만들기 대화상자(#582·#696) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 빈 이름 비활성·연속 클릭 1회 요청·취소 뒤 입력 초기화·409 인라인 에러는 브라우저 없이 판정되므로
// e2e/pages/drive/drive-space-create.spec.ts 에서 옮겼다. 드라이브 화면 배선은 drive.spec.ts 의 E2E 가 지킨다.
// 대화상자를 가진 사이드바만 renderScreen 으로 띄운다 — App 전체(renderPage)일 때 11.7초, 지금 6.3초.
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { DriveSidebar } from '@/components/drive/DriveSidebar'
import { renderScreen } from '@/test/renderScreen'
import type { DriveSpace } from '@/types/drive'

const NEW_SPACE_ID = 9

const personalSpace: DriveSpace = {
  id: 1,
  type: 'PERSONAL',
  name: '내 드라이브',
  ownerId: 1,
  role: 'OWNER',
  archived: false,
  createdAt: '2026-06-01T00:00:00Z',
}

/** 사이드바가 부르는 공간 목록·쿼터(공간·항목 조회는 이동한 뒤 화면 몫이라 여기선 쓰이지 않을 수 있다). POST 는 테스트마다 따로 준다. */
const driveHandlers = (created: { space: DriveSpace | null }) => [
  http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 })),
  http.get('/api/v1/drive/spaces', () =>
    HttpResponse.json([personalSpace, ...(created.space ? [created.space] : [])]),
  ),
  // /drive 는 개인 공간(/drive/spaces/1)으로 넘어가며 공간 하나를 조회한다.
  http.get('/api/v1/drive/spaces/:id', () => HttpResponse.json(personalSpace)),
  http.get('/api/v1/drive/spaces/:id/items', () => HttpResponse.json({ folders: [], files: [] })),
]

/** 드라이브를 열고 「팀 공간 만들기」 대화상자를 띄운다. */
async function openCreateDialog(extra: NonNullable<Parameters<typeof renderScreen>[1]> = {}) {
  const created: { space: DriveSpace | null } = { space: null }
  const view = renderScreen(<DriveSidebar />, { ...extra, path: '/drive', handlers: [...(extra.handlers ?? []), ...driveHandlers(created)] })
  await view.user.click(await screen.findByRole('button', { name: '팀 공간 만들기' }))
  await screen.findByTestId('space-name-dialog')
  return { ...view, created }
}

test('팀 공간 이름이 비거나 공백뿐이면 만들기 버튼이 비활성', async () => {
  const { user } = await openCreateDialog()
  expect(screen.getByTestId('space-name-confirm')).toBeDisabled()
  await user.type(screen.getByTestId('space-name-input'), '   ')
  expect(screen.getByTestId('space-name-confirm')).toBeDisabled()
})

test('만들기 버튼을 같은 틱에 두 번 눌러도 생성 요청은 1번만 나가고 새 공간으로 간다', async () => {
  let posts = 0
  const { user, location } = await openCreateDialog({
    handlers: [
      http.post('/api/v1/drive/spaces', async ({ request }) => {
        posts++
        const { name } = (await request.json()) as { name: string }
        return HttpResponse.json({ ...personalSpace, id: NEW_SPACE_ID, type: 'TEAM', name })
      }),
    ],
  })
  await user.type(screen.getByTestId('space-name-input'), '동시생성테스트공간')
  // React 가 다시 그려 disabled 를 반영하기 전에 두 번 — 실제 결함(#582)의 조건.
  // fireEvent 는 act 로 감싸 클릭마다 다시 그리므로(두 번째 클릭이 disabled 에 막힘) 쓰지 않고 원시 이벤트를 연달아 보낸다.
  const confirm = screen.getByTestId('space-name-confirm')
  act(() => {
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => expect(location()).toBe(`/drive/spaces/${NEW_SPACE_ID}`))
  expect(posts).toBe(1)
})

test('취소하고 다시 열면 이전 입력값이 남지 않는다', async () => {
  const { user } = await openCreateDialog()
  await user.type(screen.getByTestId('space-name-input'), '임시 테스트 공간')
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('space-name-dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '팀 공간 만들기' }))
  expect(await screen.findByTestId('space-name-input')).toHaveValue('')
})

test('이미 있는 이름이면 409 메시지를 인라인으로 보이고 대화상자를 유지한다', async () => {
  const { user, location } = await openCreateDialog({
    handlers: [
      http.post('/api/v1/drive/spaces', () =>
        HttpResponse.json({ message: '이미 존재하는 공간 이름입니다: 중복 공간' }, { status: 409 }),
      ),
    ],
  })
  await user.type(screen.getByTestId('space-name-input'), '중복 공간')
  await user.click(screen.getByTestId('space-name-confirm'))
  expect(await screen.findByTestId('space-name-error')).toHaveTextContent('이미 존재하는 공간 이름입니다: 중복 공간')
  expect(screen.getByTestId('space-name-dialog')).toBeInTheDocument()
  expect(location()).not.toBe(`/drive/spaces/${NEW_SPACE_ID}`)
})
