// 여러 화면의 폼 대화상자 공통 동작 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 닫았다 다시 열면 입력이 남지 않음(#178, 역할 추가), 필수 칸 표시 *(외부 연락처), 제출 중 「… 중…」 표시·비활성(#131, 채널 만들기·이름 바꾸기)은
// 브라우저 없이 판정되므로 e2e/pages/dialog-state-reset.spec.ts · required-field-indicators.spec.ts · submit-loading-state.spec.ts 에서 옮겼다.
// 이슈·프로젝트 만들기 대화상자의 같은 판정은 src/pages/projects/issueCreateValidation.test.tsx · projectCreateValidation.test.tsx 에 있다.
// 대화상자(또는 대화상자를 가진 가장 작은 화면)만 renderScreen 으로 띄운다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { CreateChannelModal } from '@/components/chat/CreateChannelModal'
import { RenameChannelModal } from '@/components/chat/RenameChannelModal'
import { ExternalContactFormDialog } from '@/components/contacts/ExternalContactFormDialog'
import RoleListPage from '@/pages/admin/RoleListPage'
import { renderScreen } from '@/test/renderScreen'
import type { RoleResponse } from '@/types/role'

import { createChannel } from '../../e2e/factories/messaging.factory'

/** 응답을 붙잡아 두는 지연 — release() 전까지 요청이 끝나지 않아 「제출 중」 상태를 관찰할 수 있다. */
function hold() {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  return { held, release }
}

describe('역할 추가 대화상자 (#178)', () => {
  const roles: RoleResponse[] = [
    { id: 1, name: 'ADMIN', description: '시스템 관리자', isSystem: true },
    { id: 2, name: 'USER', description: '일반 사용자', isSystem: true },
  ]

  test('Escape 로 닫고 다시 열면 역할 이름이 비어 있다', async () => {
    const { user } = renderScreen(<RoleListPage />, {
      path: '/settings/roles',
      handlers: [http.get('/api/v1/roles', () => HttpResponse.json(roles))],
      auth: { isAdmin: true },
    })
    await user.click(await screen.findByRole('button', { name: '역할 추가' }))
    await screen.findByRole('dialog', { name: '새 역할 생성' })
    await user.click(screen.getByLabelText('역할 이름'))
    await user.paste('테스트 역할')
    expect(screen.getByLabelText('역할 이름')).toHaveValue('테스트 역할')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 역할 생성' })).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '역할 추가' }))
    await screen.findByRole('dialog', { name: '새 역할 생성' })
    expect(screen.getByLabelText('역할 이름')).toHaveValue('')
  })
})

describe('외부 연락처 대화상자 — 필수 표시', () => {
  // FormField 의 required 가 라벨 끝에 붉은 별표(text-destructive *)를 그린다 — 이름만 필수다.
  test('이름 라벨에 필수 표시(*)가 있다', async () => {
    renderScreen(<ExternalContactFormDialog open onOpenChange={() => {}} />)
    const dialog = await screen.findByTestId('external-contact-dialog')
    const label = dialog.querySelector('label[for="c-name"]') as HTMLElement
    expect(label).toHaveTextContent('*')
    expect(label.querySelector('span.text-destructive')).toHaveTextContent('*')
  })
})

describe('채널 대화상자 — 제출 중 표시 (#131)', () => {
  test('채널 만들기 — 응답을 기다리는 동안 버튼이 「생성 중…」 이고 비활성, 끝나면 새 채널로 간다', async () => {
    const { held, release } = hold()
    const bodies: unknown[] = []
    const created = createChannel({ id: 9, name: '테스트채널', visibility: 'PUBLIC', role: 'OWNER' })
    const { user, location } = renderScreen(<CreateChannelModal open onOpenChange={() => {}} />, {
      path: '/chat',
      handlers: [
        http.post('/api/v1/messaging/channels', async ({ request }) => {
          bodies.push(await request.json())
          await held
          return HttpResponse.json(created, { status: 201 })
        }),
      ],
    })
    await user.click(await screen.findByTestId('create-channel-name'))
    await user.paste('테스트채널')
    const submit = screen.getByTestId('create-channel-submit')
    await user.click(submit)
    await waitFor(() => expect(submit).toHaveTextContent('생성 중…'))
    expect(submit).toBeDisabled()
    expect(bodies).toEqual([{ name: '테스트채널', visibility: 'PUBLIC' }])

    release()
    await waitFor(() => expect(location()).toBe('/chat/channels/9'))
  })

  test('채널 이름 바꾸기 — 응답을 기다리는 동안 버튼이 「저장 중…」 이고 비활성이다', async () => {
    const { held, release } = hold()
    const bodies: unknown[] = []
    const ch = createChannel({ id: 5, name: '기존채널', visibility: 'PUBLIC', role: 'OWNER', member: true })
    const { user } = renderScreen(<RenameChannelModal channelId={5} currentName="기존채널" open onOpenChange={() => {}} />, {
      handlers: [
        http.patch('/api/v1/messaging/channels/5', async ({ request }) => {
          bodies.push(await request.json())
          await held
          return HttpResponse.json({ ...ch, name: '변경채널' })
        }),
      ],
    })
    const input = await screen.findByTestId('rename-channel-name')
    await user.clear(input)
    await user.paste('변경채널')
    const submit = screen.getByTestId('rename-channel-submit')
    await user.click(submit)
    await waitFor(() => expect(submit).toHaveTextContent('저장 중…'))
    expect(submit).toBeDisabled()
    expect(bodies).toEqual([expect.objectContaining({ name: '변경채널' })])
    release()
    await waitFor(() => expect(submit).not.toHaveTextContent('저장 중…'))
  })
})
