// 여러 화면의 폼 대화상자 공통 동작 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 닫았다 다시 열면 입력이 남지 않음(#178, 역할 추가), 필수 칸 표시 *(외부 연락처), 제출 중 「… 중…」 표시·비활성(#131, 채널 만들기·이름 바꾸기)은
// 브라우저 없이 판정되므로 e2e/pages/dialog-state-reset.spec.ts · required-field-indicators.spec.ts · submit-loading-state.spec.ts 에서 옮겼다.
// 이슈·프로젝트 만들기 대화상자의 같은 판정은 src/pages/projects/issueCreateValidation.test.tsx · projectCreateValidation.test.tsx 에 있다.
// 대화상자(또는 대화상자를 가진 가장 작은 화면)만 renderScreen 으로 띄운다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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

// 채널 이름 변경 창 — 입력칸에 보이는 라벨 「채널 이름」 이 이어지고, Enter 로도 저장된다(WP-1615).
// Enter 저장도 「저장」 단추의 비활성 조건(빈 이름·지금 이름 그대로·처리 중)을 그대로 지키고, 한글 조합 Enter 는 저장으로 보지 않는다.
describe('채널 이름 변경 창 — 라벨과 Enter 저장 (WP-1615)', () => {
  /**
   * 이름 변경 창을 띄우고 이름 변경(PATCH)·보관 해제(POST unarchive) 요청 본문을 모은다.
   * held 를 주면 응답을 붙잡아 「처리 중」 을 관찰할 수 있고, error 를 주면 그 상태·문구로 실패 응답한다.
   */
  async function renderRename({
    mode = 'rename',
    currentName = '기존채널',
    held,
    error,
  }: {
    mode?: 'rename' | 'unarchive'
    currentName?: string
    held?: Promise<void>
    error?: { status: number; message: string }
  } = {}) {
    const bodies: unknown[] = []
    const closes: boolean[] = []
    const respond = async (request: Request, ok: () => Response) => {
      bodies.push(await request.json())
      if (held) await held
      return error ? HttpResponse.json({ message: error.message }, { status: error.status }) : ok()
    }
    const { user } = renderScreen(
      <RenameChannelModal
        channelId={5}
        currentName={currentName}
        mode={mode}
        open
        onOpenChange={(v) => closes.push(v)}
      />,
      {
        handlers: [
          http.patch('/api/v1/messaging/channels/5', ({ request }) => respond(request, () => HttpResponse.json({}))),
          http.post('/api/v1/messaging/channels/5/unarchive', ({ request }) =>
            respond(request, () => new HttpResponse(null, { status: 204 })),
          ),
        ],
      },
    )
    const input = await screen.findByRole<HTMLInputElement>('textbox', { name: '채널 이름' })
    /** 입력칸을 비우고 새 이름을 채운다. */
    const fill = async (value: string) => {
      await user.clear(input)
      await user.paste(value)
    }
    return { user, input, fill, bodies, closes }
  }

  /** 「요청이 없다」 를 네트워크 계층에서 확인하기 전 잠시 기다린다 — 요청이 나갔다면 이 사이 핸들러에 닿는다. */
  const letStrayRequestArrive = () => new Promise((r) => setTimeout(r, 50))

  test.each(['rename', 'unarchive'] as const)('%s 모드 — 입력칸을 「채널 이름」 으로 찾을 수 있다', async (mode) => {
    const { input } = await renderRename({ mode })
    expect(input).toHaveValue('기존채널')
  })

  test('이름을 바꾸고 Enter 를 누르면 이름 변경 요청이 한 번 가고 창이 닫힌다', async () => {
    const { user, fill, bodies, closes } = await renderRename()
    await fill('변경채널')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(closes).toEqual([false]))
    expect(bodies).toEqual([{ name: '변경채널' }])
  })

  test('처리 중에 Enter 를 거듭 눌러도 요청은 한 번만 간다', async () => {
    const { held, release } = hold()
    const { user, fill, bodies } = await renderRename({ held })
    await fill('변경채널')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('rename-channel-submit')).toHaveTextContent('저장 중…'))
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    release()
    await waitFor(() => expect(screen.getByTestId('rename-channel-submit')).not.toHaveTextContent('저장 중…'))
    expect(bodies).toEqual([{ name: '변경채널' }])
  })

  test('같은 틱에 Enter 와 저장 클릭이 겹쳐도(다시 그리기 전) 요청은 한 번만 간다', async () => {
    const { held, release } = hold()
    const { input, fill, bodies } = await renderRename({ held })
    await fill('변경채널')
    const submit = screen.getByTestId('rename-channel-submit')
    // fireEvent 는 매번 다시 그려 두 번째가 pending(비활성)에 막힌다 — 한 act 안에서 연달아 보내 렌더 전 경합을 만든다.
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(bodies).toHaveLength(1))
    release()
    await waitFor(() => expect(submit).not.toHaveTextContent('저장 중…'))
    expect(bodies).toEqual([{ name: '변경채널' }])
  })

  test('공백만 남긴 이름으로 Enter 를 누르면 요청을 보내지 않는다', async () => {
    const { user, fill, bodies } = await renderRename()
    await fill('   ')
    await user.keyboard('{Enter}')
    await letStrayRequestArrive()
    expect(bodies).toEqual([])
    expect(screen.getByTestId('rename-channel-modal')).toBeInTheDocument()
  })

  test('이름 변경 — 지금 이름 그대로면 저장 단추가 비활성이고 Enter 로도 요청이 가지 않는다', async () => {
    const { user, input, bodies } = await renderRename()
    expect(screen.getByTestId('rename-channel-submit')).toBeDisabled()
    await user.click(input)
    await user.keyboard('{Enter}')
    await letStrayRequestArrive()
    expect(bodies).toEqual([])
  })

  test('이름 변경 — 대소문자만 바꾸는 변경은 보낸다', async () => {
    const { user, fill, bodies } = await renderRename({ currentName: 'general' })
    await fill('General')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(bodies).toEqual([{ name: 'General' }]))
  })

  test('보관 해제 — 같은 이름 그대로 Enter 는 요청이 없고, 새 이름으로 Enter 하면 그 이름으로 해제한다', async () => {
    const { user, input, fill, bodies, closes } = await renderRename({ mode: 'unarchive' })
    await user.click(input)
    await user.keyboard('{Enter}')
    await letStrayRequestArrive()
    expect(bodies).toEqual([])

    await fill('새채널')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(closes).toEqual([false]))
    expect(bodies).toEqual([{ name: '새채널' }])
  })

  test.each([
    ['조합 중(isComposing)', { isComposing: true }],
    ['keyCode 229(Safari 조합 확정)', { keyCode: 229 }],
  ])('%s Enter 는 저장하지 않는다', async (_label, init) => {
    const { input, fill, bodies } = await renderRename()
    await fill('변경채널')
    fireEvent.keyDown(input, { key: 'Enter', ...init })
    await letStrayRequestArrive()
    expect(bodies).toEqual([])
    expect(screen.getByTestId('rename-channel-modal')).toBeInTheDocument()
  })

  test('서버가 이름 중복(409)을 돌려주면 오류 문구가 보이고 입력칸이 그 문구를 설명으로 가리킨다', async () => {
    const { user, input, fill } = await renderRename({
      error: { status: 409, message: '이미 같은 이름의 채널이 있습니다.' },
    })
    // 오류가 없을 때는 없는 id 를 가리키지 않는다.
    expect(input).not.toHaveAttribute('aria-describedby')
    await fill('겹치는채널')
    await user.keyboard('{Enter}')
    const error = await screen.findByTestId('rename-channel-name-error')
    expect(error).toHaveTextContent('이미 같은 이름의 채널이 있습니다.')
    expect(input).toHaveAccessibleDescription('이미 같은 이름의 채널이 있습니다.')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })
})
