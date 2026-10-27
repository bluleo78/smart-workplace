// 프로젝트 만들기 대화상자 유효성 검사(#177·WP-465·WP-466·WP-692) — 화면 테스트(WP-971, WP-1002 에서 대화상자만 띄우게 바꿈).
// 한국어 오류 문구·공백 이름 차단·aria-invalid/aria-describedby 연결·409 를 key 칸 오류로 보이기는
// 브라우저 없이 판정되므로 e2e/pages/projects/project-create-validation.spec.ts 에서 옮겼다(그 spec 은 지웠다).
// 프로젝트 목록 화면 배선은 e2e/pages/projects/project-list.spec.ts 의 @wiring 이 지킨다.
// 닫았다 다시 열면 입력이 남지 않음(#178)과 비밀번호 관리자 메뉴 클릭에 닫히지 않음(WP-96)은
// e2e/pages/dialog-state-reset.spec.ts · dialog-password-manager.spec.ts 에서 옮겼다(WP-982).
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, test } from 'vitest'

import { Button } from '@/components/ui/button'
import { ProjectCreateDialog } from '@/pages/projects/components/ProjectCreateDialog'
import { renderScreen } from '@/test/renderScreen'

import { createProject } from '../../../e2e/factories/project.factory'
import { createPageResponse } from '../../../e2e/fixtures/api-mock'

/** 프로젝트 목록의 「+ 새 프로젝트」 버튼과 대화상자만 둔 자리 — 목록 화면과 같이 버튼이 open 을 켜고 대화상자가 끈다. */
function CreateDialogHost() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ 새 프로젝트</Button>
      <ProjectCreateDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** 「+ 새 프로젝트」 대화상자를 띄운다. POST 는 테스트가 준다(없으면 테스트 실패 — 요청이 나가면 안 되는 테스트). */
async function openCreateDialog(post?: Parameters<typeof http.post>[1]) {
  const handlers = [http.get('/api/v1/projects', () => HttpResponse.json(createPageResponse([createProject()])))]
  if (post) handlers.push(http.post('/api/v1/projects', post))
  const view = renderScreen(<CreateDialogHost />, { path: '/projects', handlers })
  await view.user.click(await screen.findByRole('button', { name: '+ 새 프로젝트' }))
  await screen.findByRole('dialog', { name: '새 프로젝트' })
  return view
}

/** 입력칸 값 채우기 — 글자 하나하나는 의미가 없어 붙여넣기로 채운다. 필수 칸 라벨 끝의 별표 때문에 라벨은 앞부분으로 찾는다. */
async function fill(user: ReturnType<typeof renderScreen>['user'], label: RegExp, value: string) {
  const input = screen.getByLabelText(label)
  await user.clear(input)
  await user.click(input)
  await user.paste(value)
}

/** 입력과 aria-describedby 로 이어진 오류 요소. */
function errorOf(input: HTMLElement) {
  const id = input.getAttribute('aria-describedby')
  return id ? document.getElementById(id) : null
}

test('이름이 120자를 넘으면 Zod 영문 기본 문구 대신 한국어 오류를 보인다 (#177)', async () => {
  const { user } = await openCreateDialog()
  await fill(user, /^key \(예: WP\)/, 'TESTKEY')
  await fill(user, /^이름/, '가'.repeat(121))
  await user.click(screen.getByRole('button', { name: '생성' }))
  expect(await screen.findByText('이름은 120자 이하여야 합니다')).toBeInTheDocument()
  expect(screen.queryByText(/Too big/)).not.toBeInTheDocument()
})

test('이름이 공백뿐이면 서버 요청 없이 이름 필드에 필수 오류를 보인다 (WP-465)', async () => {
  let posted = 0
  const { user } = await openCreateDialog(() => {
    posted++
    return HttpResponse.json({ message: '공백일 수 없습니다' }, { status: 400 })
  })
  await fill(user, /^key \(예: WP\)/, 'SPACE')
  await fill(user, /^이름/, '   ')
  await user.click(screen.getByRole('button', { name: '생성' }))
  expect(await screen.findByText('이름은 필수입니다')).toBeInTheDocument()
  expect(screen.queryByText('공백일 수 없습니다')).not.toBeInTheDocument()
  expect(posted).toBe(0)
})

test('빈 값으로 생성하면 key·이름 입력이 aria-invalid·aria-describedby 로 role=alert 오류와 이어진다 (WP-466)', async () => {
  const { user } = await openCreateDialog()
  await user.click(screen.getByRole('button', { name: '생성' }))
  for (const [id, message] of [
    ['project-key', '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다'],
    ['project-name', '이름은 필수입니다'],
  ] as const) {
    const input = document.getElementById(id)!
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    const error = errorOf(input)
    expect(error).toHaveTextContent(message)
    expect(error).toHaveAttribute('role', 'alert')
  }
})

test('삭제된 프로젝트의 key(409)면 서버 문구가 토스트가 아닌 key 칸 오류로 보이고 창은 열려 있다 (WP-692)', async () => {
  const message = '삭제된 프로젝트가 쓰던 key 라 다시 쓸 수 없습니다: GONE — 다른 key 를 써 주세요'
  let body: unknown
  const { user } = await openCreateDialog(async ({ request }) => {
    body = await request.json()
    return HttpResponse.json({ status: 409, message }, { status: 409 })
  })
  await fill(user, /^key \(예: WP\)/, 'GONE')
  await fill(user, /^이름/, '새 프로젝트')
  await user.click(screen.getByRole('button', { name: '생성' }))

  const input = document.getElementById('project-key')!
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  expect(errorOf(input)).toHaveTextContent(message)
  // 서버 오류 뒤 key 칸으로 포커스를 옮겨 바로 고치게 한다.
  await waitFor(() => expect(input).toHaveFocus())
  expect(screen.getByRole('dialog', { name: '새 프로젝트' })).toBeInTheDocument()
  // 같은 문구가 토스트로도 뜨면 안 된다 — 대화상자 배경 뒤로 가려 읽을 수 없었다.
  expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(0)
  expect(body).toMatchObject({ key: 'GONE', name: '새 프로젝트', type: 'TEAM' })

  // key 를 고치면 서버 오류가 사라진다(다시 검증).
  await fill(user, /^key \(예: WP\)/, 'NEWKEY')
  await waitFor(() => expect(input).not.toHaveAttribute('aria-invalid', 'true'))
})

// #178 — 닫혀 있는 동안 폼 상태가 남아 다시 열면 이전 입력이 보이던 결함.
test('Escape 로 닫고 다시 열면 key·이름 입력이 비어 있다 (#178)', async () => {
  const { user } = await openCreateDialog()
  await fill(user, /^key \(예: WP\)/, 'MYKEY')
  await fill(user, /^이름/, '내 프로젝트')
  expect(screen.getByLabelText(/^key \(예: WP\)/)).toHaveValue('MYKEY')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 프로젝트' })).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '+ 새 프로젝트' }))
  await screen.findByRole('dialog', { name: '새 프로젝트' })
  expect(screen.getByLabelText(/^key \(예: WP\)/)).toHaveValue('')
  expect(screen.getByLabelText(/^이름/)).toHaveValue('')
})

// WP-96 — 1Password 등은 자동완성 메뉴를 body 직속 커스텀 엘리먼트(shadow root)로 주입한다. 그 메뉴를 누르는 것은 대화상자 바깥
// pointerdown 이지만 닫으면 안 된다. 진짜 바깥(오버레이)을 누르면 여전히 닫힌다 — 같은 화면에서 양성 대조로 본다.
test('비밀번호 관리자 메뉴를 눌러도 대화상자가 닫히지 않고, 오버레이를 누르면 닫힌다 (WP-96)', async () => {
  await openCreateDialog()
  const host = document.createElement('com-1password-menu')
  const button = document.createElement('button')
  button.textContent = '1Password로 채우기'
  host.attachShadow({ mode: 'open' }).appendChild(button)
  document.body.appendChild(host)
  // Radix 는 열린 직후 다음 틱에 바깥 pointerdown 리스너를 건다.
  await new Promise((r) => setTimeout(r, 0))
  try {
    // shadow root 안 버튼 — 문서 리스너에는 host 로 리타깃돼 도착한다(composed).
    fireEvent.pointerDown(button, { composed: true })
    fireEvent.click(button, { composed: true })
    expect(screen.getByRole('dialog', { name: '새 프로젝트' })).toBeInTheDocument()

    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement
    fireEvent.pointerDown(overlay)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 프로젝트' })).not.toBeInTheDocument())
  } finally {
    host.remove()
  }
})
