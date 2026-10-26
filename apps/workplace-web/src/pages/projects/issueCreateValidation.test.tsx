// 이슈 만들기 대화상자 유효성 검사(#163·#612)와 새로고침 유실 경고 해제(#620) — 페이지 테스트(WP-971).
// 공백뿐인 제목이 인라인 오류로 막히고 서버로 가지 않는지, 입력 중 켜진 beforeunload 경고가 닫으면 꺼지는지는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-create-validation.spec.ts 에서 옮겼다(그 spec 은 지웠다).
// 검증 규칙 자체(trim·200자 경계)는 src/lib/validations/issue.test.ts, 경고 켜짐 조건은 src/lib/issueDraft.test.ts 가 맡는다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

/** 프로젝트·이슈 목록·유형 — 생성 POST 는 횟수만 센다(400 으로 돌려 실수로 나가도 화면이 닫히지 않게). */
function projectHandlers(posts: { count: number }) {
  return [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([createIssue({ title: '기존 이슈' })]))),
    http.post(`/api/v1/projects/${KEY}/issues`, () => {
      posts.count++
      return HttpResponse.json({}, { status: 400 })
    }),
  ]
}

/** 목록을 열고 「+ 새 태스크」로 대화상자를 띄운다. */
async function openCreateDialog() {
  const posts = { count: 0 }
  const view = renderPage(`/projects/${KEY}`, { handlers: projectHandlers(posts) })
  await view.user.click(await screen.findByRole('button', { name: '+ 새 태스크' }, { timeout: PAGE_LOAD_TIMEOUT }))
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
