// 설정 › 역할 목록·상세(/settings/roles, /settings/roles/:id) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 할당된 역할 삭제 400 사유 토스트(#678), 커스텀 역할 편집 가능(#185), 설명 255자 초과 안내·전송 차단(WP-570)은
// 응답 → 화면, 입력 → 검증이라 브라우저 없이 판정되므로 e2e/pages/admin/role-list.spec.ts · role-detail.spec.ts 에서 옮겼다.
// E2E 에 남는 것: 삭제 성공 배선(role-list @wiring), 행 키보드 진입(@input), 시스템 역할 잠금 배선(role-detail @wiring).
// 목록·상세 페이지 컴포넌트를 renderScreen 으로 띄운다(상세는 useParams 를 위해 라우트 패턴으로 감싼다).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { createPermissions, createRoleDetail } from '../../../e2e/factories/admin.factory'
import { createRole } from '../../../e2e/factories/auth.factory'
import RoleDetailPage from './RoleDetailPage'
import RoleListPage from './RoleListPage'

const ROLES = [
  createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
  createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }),
  createRole({ id: 3, name: 'EDITOR', description: '편집자', isSystem: false }),
]

test('사용자에게 할당된 역할을 지우려 하면 서버 400 사유를 토스트로 보이고 목록에 남긴다 (#678)', async () => {
  const { user } = renderScreen(<RoleListPage />, {
    path: '/settings/roles',
    handlers: [
      http.get('/api/v1/roles', () => HttpResponse.json(ROLES)),
      http.delete('/api/v1/roles/3', () =>
        HttpResponse.json({ message: '1명의 사용자에게 할당된 역할은 삭제할 수 없습니다: EDITOR' }, { status: 400 }),
      ),
    ],
  })
  await user.click(await screen.findByRole('button', { name: 'EDITOR 역할 삭제' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '삭제' }))

  expect(await screen.findByText('1명의 사용자에게 할당된 역할은 삭제할 수 없습니다: EDITOR')).toBeInTheDocument()
  // 확인창이 닫힌 뒤(열려 있는 동안 표는 aria-hidden) 행이 그대로인지 본다.
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  // 행은 role=button 이라 셀이 접근성 트리에 없다 — 행 이름으로 본다.
  expect(screen.getByRole('button', { name: 'EDITOR 상세 보기' })).toBeInTheDocument()
})

/** 역할 상세를 띄운다 — 커스텀 역할(EDITOR). 역할 정보 PUT 횟수를 센다. */
function renderCustomRoleDetail() {
  const puts: unknown[] = []
  const view = renderScreen(
    <Routes>
      <Route path="/settings/roles/:id" element={<RoleDetailPage />} />
    </Routes>,
    {
      path: '/settings/roles/3',
      handlers: [
        http.get('/api/v1/roles/3', () =>
          HttpResponse.json(createRoleDetail({ id: 3, name: 'EDITOR', description: '편집자 역할', isSystem: false })),
        ),
        http.get('/api/v1/permissions', () => HttpResponse.json(createPermissions())),
        http.put('/api/v1/roles/3', async ({ request }) => {
          puts.push(await request.json())
          return HttpResponse.json({})
        }),
      ],
    },
  )
  return { ...view, puts }
}

test('커스텀 역할 상세는 역할 이름·설명·저장이 모두 편집 가능하다 (#185)', async () => {
  renderCustomRoleDetail()
  expect(await screen.findByRole('textbox', { name: '역할 이름' })).toBeEnabled()
  expect(screen.getByRole('textbox', { name: '설명' })).toBeEnabled()
  // name 은 전체 일치라 「권한 저장」 버튼과 구분된다.
  expect(screen.getByRole('button', { name: '저장' })).toBeEnabled()
  expect(screen.queryByText('시스템 역할은 이름·설명·권한을 수정할 수 없습니다.')).not.toBeInTheDocument()
})

test('커스텀 역할 설명이 255자를 넘으면 칸 아래 한국어 안내가 뜨고 저장 요청을 보내지 않는다 (WP-570)', async () => {
  const { user, puts } = renderCustomRoleDetail()
  const description = await screen.findByRole('textbox', { name: '설명' })
  await user.clear(description)
  await user.click(description)
  await user.paste('x'.repeat(256))
  await user.click(screen.getByRole('button', { name: '저장' }))

  expect(await screen.findByText('역할 설명은 255자까지 쓸 수 있습니다', { exact: false })).toBeInTheDocument()
  await waitFor(() => expect(puts).toEqual([]))
})
