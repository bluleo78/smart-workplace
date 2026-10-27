// 이슈 만들기 대화상자 유효성 검사(#163·#612)와 새로고침 유실 경고 해제(#620) — 페이지 테스트(WP-971).
// 공백뿐인 제목이 인라인 오류로 막히고 서버로 가지 않는지, 입력 중 켜진 beforeunload 경고가 닫으면 꺼지는지는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-create-validation.spec.ts 에서 옮겼다(그 spec 은 지웠다).
// 검증 규칙 자체(trim·200자 경계)는 src/lib/validations/issue.test.ts, 경고 켜짐 조건은 src/lib/issueDraft.test.ts 가 맡는다.
// 닫았다 다시 열면 입력·오류가 남지 않음(#178)·제목 칸 필수 표시(*)·제출 중 「생성 중…」(#131)은
// e2e/pages/dialog-state-reset.spec.ts · required-field-indicators.spec.ts · submit-loading-state.spec.ts 에서 옮겼다(WP-982).
// 화면 컴포넌트 테스트(WP-1002) — 목록 화면 대신 만들기 대화상자와 그것을 여는 「+ 새 태스크」만 띄운다(issueCreateDialogScreen).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderCreateDialog } from '@/test/kits/projects/issueCreateDialogScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'

/** 생성 POST — 횟수만 센다(400 으로 돌려 실수로 나가도 화면이 닫히지 않게). post 를 주면 그 응답을 쓴다. */
function projectHandlers(posts: { count: number }, post?: Parameters<typeof http.post>[1]) {
  return [
    http.post(`/api/v1/projects/${KEY}/issues`, (info) => {
      posts.count++
      return post ? post(info) : HttpResponse.json({}, { status: 400 })
    }),
  ]
}

/** 「+ 새 태스크」로 대화상자를 띄운다(목록 화면 대신 버튼과 대화상자만 — issueCreateDialogScreen). */
async function openCreateDialog(post?: Parameters<typeof http.post>[1]) {
  const posts = { count: 0 }
  const view = renderCreateDialog(KEY, projectHandlers(posts, post))
  await view.user.click(await screen.findByRole('button', { name: '+ 새 태스크' }, { timeout: SCREEN_LOAD_TIMEOUT }))
  await screen.findByRole('dialog', { name: '새 이슈' })
  return { ...view, posts }
}

/** beforeunload 를 직접 보내 리스너가 막는지(preventDefault) 본다 — 실제 확인창은 브라우저도 headless 에선 띄우지 않는다. */
function dispatchBeforeUnload() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

test('제목이 공백뿐이면 서버 요청 없이 인라인 오류를 보이고 대화상자는 열려 있다 (#612)', async () => {
  const { user, posts } = await openCreateDialog()
  await user.type(screen.getByLabelText(/^제목/), '   ')
  await user.click(screen.getByRole('button', { name: '생성' }))
  expect(await screen.findByText('제목은 필수입니다')).toBeInTheDocument()
  expect(posts.count).toBe(0)
  expect(screen.getByRole('dialog', { name: '새 이슈' })).toBeInTheDocument()
})

test('제목을 쓰면 beforeunload 경고가 켜지고, 대화상자를 닫으면 꺼진다 (#620)', async () => {
  const { user } = await openCreateDialog()
  await user.click(screen.getByLabelText(/^제목/))
  await user.paste('작성 중인 제목')
  await waitFor(() => expect(dispatchBeforeUnload()).toBe(true))
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 이슈' })).not.toBeInTheDocument())
  expect(dispatchBeforeUnload()).toBe(false)
})

/** 「+ 새 태스크」로 대화상자를 다시 연다. */
async function reopen(user: Awaited<ReturnType<typeof openCreateDialog>>['user']) {
  await user.click(screen.getByRole('button', { name: '+ 새 태스크' }))
  return screen.findByRole('dialog', { name: '새 이슈' })
}

/** 대화상자가 닫힐 때까지 기다린다. */
async function closed() {
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 이슈' })).not.toBeInTheDocument())
}

// #178 — 닫혀 있는 동안 폼 상태가 남아 다시 열면 이전 입력·오류가 보이던 결함. Escape·취소 두 닫기 경로를 한 화면에서 이어 본다
// (테스트마다 앱을 띄우면 2초 넘게 들어 한 번 띄운 화면에서 이어 간다). 제목 라벨의 필수 표시(*)도 함께 본다.
test('Escape·취소로 닫고 다시 열면 입력값·유효성 오류가 남지 않고, 제목 라벨엔 필수 표시(*)가 있다 (#178)', async () => {
  const { user } = await openCreateDialog()
  // 필수 칸 표시 — FormField 의 required 가 라벨 끝에 붉은 별표(text-destructive *)를 그린다.
  const label = document.querySelector('label[for="issue-title"]') as HTMLElement
  expect(label.querySelector('span.text-destructive')).toHaveTextContent('*')

  // Escape — 입력값.
  await user.click(screen.getByLabelText(/^제목/))
  await user.paste('테스트 제목')
  expect(screen.getByLabelText(/^제목/)).toHaveValue('테스트 제목')
  await user.keyboard('{Escape}')
  await closed()
  await reopen(user)
  expect(screen.getByLabelText(/^제목/)).toHaveValue('')

  // Escape — 유효성 오류.
  await user.click(screen.getByRole('button', { name: '생성' }))
  expect(await screen.findByText('제목은 필수입니다')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await closed()
  await reopen(user)
  expect(screen.queryByText('제목은 필수입니다')).not.toBeInTheDocument()

  // 취소 — 입력값.
  await user.click(screen.getByLabelText(/^제목/))
  await user.paste('임시 제목')
  await user.click(screen.getByRole('button', { name: '취소' }))
  await closed()
  await reopen(user)
  expect(screen.getByLabelText(/^제목/)).toHaveValue('')
})

// #131 — 응답을 기다리는 동안 버튼이 「생성 중…」으로 바뀌고 비활성이라 두 번 누를 수 없다.
test('제출 중에는 버튼이 「생성 중…」 이고 비활성이다 (#131)', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const { user } = await openCreateDialog(async () => {
    await held
    return HttpResponse.json(createIssue({ title: '새 이슈' }), { status: 201 })
  })
  await user.click(screen.getByLabelText(/^제목/))
  await user.paste('새 이슈')
  await user.click(screen.getByRole('button', { name: '생성' }))
  expect(await screen.findByRole('button', { name: '생성 중…' })).toBeDisabled()
  release()
  await closed()
})
