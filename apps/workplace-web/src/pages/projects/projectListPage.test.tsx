// 프로젝트 목록·생성 다이얼로그·설정·리소스 오류 화면 — 페이지 테스트(WP-971).
// 빈 상태·목록 오류와 다시 시도·403/404 오류 화면·생성 payload(팀/공개/개인)·key 유효성·설정 검증·삭제 뒤 이동은
// 브라우저 없이 판정되므로 e2e/pages/projects/{projects,personal-projects,open-project-create,resource-error-state}.spec.ts 에서 옮겼다.
// 프로젝트 생성 → 이슈 생성 → 상태 변경 → 코멘트로 이어지는 화면 흐름(@flow)은 projects.spec.ts 의 E2E 가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, issueDetailScreen, projectScreen } from '@/test/kits/projects/projectScreens'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { ProjectResponse } from '@/types/project'

import { createMember, createProject } from '../../../e2e/factories/project.factory'

/** 필수 칸 라벨은 뒤에 표식이 붙는다 — 앞부분으로 찾는다. */
const KEY_LABEL = /^key \(예: WP\)/
const NAME_LABEL = /^이름/

/** 페이지 응답(Spring Page) — e2e 의 createPageResponse 와 같은 모양. */
const pageOf = <T,>(content: T[]) => ({ content, page: 0, size: 10, totalElements: content.length, totalPages: content.length ? 1 : 0 })

/** 프로젝트 목록 GET(가변) + 생성 POST — POST 본문은 posts 에 쌓고, 응답 프로젝트를 목록에 더한다. */
function projectsApi(initial: ProjectResponse[] = [], created?: ProjectResponse) {
  const list = [...initial]
  const posts: Record<string, unknown>[] = []
  const handlers = [
    http.get(`${API}/projects`, () => HttpResponse.json(pageOf(list))),
    http.post(`${API}/projects`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      posts.push(body)
      const project = created ?? createProject({ key: String(body.key ?? 'NEW'), name: String(body.name) })
      list.push(project)
      return HttpResponse.json(project)
    }),
  ]
  return { handlers, posts }
}

/** 목록에서 「+ 새 프로젝트」 다이얼로그를 연다. */
async function openCreateDialog(api = projectsApi([createProject()])) {
  const view = renderPage('/projects', { handlers: api.handlers })
  await view.user.click(await screen.findByRole('button', { name: '+ 새 프로젝트' }, { timeout: PAGE_LOAD_TIMEOUT }))
  const dialog = await screen.findByRole('dialog', { name: '새 프로젝트' })
  return { ...view, api, dialog }
}

describe('프로젝트 목록', () => {
  // 프로젝트가 하나도 없을 때 제목·설명·CTA 가 보이고, CTA 가 생성 다이얼로그를 연다(#296).
  test('프로젝트가 없으면 빈 상태와 「새 프로젝트 만들기」 CTA 가 보이고 누르면 생성 다이얼로그가 열린다', async () => {
    const { user } = renderPage('/projects', { handlers: projectsApi([]).handlers })
    const empty = await screen.findByTestId('projects-empty', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(within(empty).getByText('아직 프로젝트가 없어요')).toBeInTheDocument()
    expect(within(empty).getByText('팀원과 함께 작업할 프로젝트를 만들어 보세요.')).toBeInTheDocument()
    await user.click(within(empty).getByRole('button', { name: '새 프로젝트 만들기' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // 목록 API 실패 → 오류 문구와 「다시 시도」, 다시 시도가 성공하면 목록이 보인다(#189).
  test('목록 API 가 500 이면 오류와 「다시 시도」가 보이고, 다시 시도가 성공하면 목록이 보인다', async () => {
    let attempt = 0
    const { user } = renderPage('/projects', {
      handlers: [
        http.get(`${API}/projects`, () => {
          attempt++
          return attempt === 1
            ? HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
            : HttpResponse.json(pageOf([createProject({ name: 'Workplace' })]))
        }),
      ],
    })
    expect(await screen.findByText('프로젝트 목록을 불러오지 못했습니다.', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByText('프로젝트 목록을 불러오지 못했습니다.')).not.toBeInTheDocument())
    expect(within(screen.getByRole('main')).getAllByRole('link', { name: /Workplace/ })[0]).toBeInTheDocument()
  })
})

describe('프로젝트 생성 다이얼로그', () => {
  // 기본 유형은 팀 — 「프로젝트 유형」 묶음의 눌림 토글로 알리고(탭이 아님, WP-855), 공개를 고르면 key 칸이 그대로 있다.
  test('유형 토글: 기본 팀이 눌려 있고 공개로 바꿔도 key 칸이 보인다, 개인이면 key 칸이 사라진다', async () => {
    const { user, dialog } = await openCreateDialog()
    const typeGroup = within(dialog).getByRole('group', { name: '프로젝트 유형' })
    expect(within(typeGroup).getByRole('button', { name: '팀' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(within(dialog).getByLabelText(KEY_LABEL)).toBeInTheDocument()

    await user.click(within(typeGroup).getByRole('button', { name: '공개' }))
    expect(within(typeGroup).getByRole('button', { name: '공개' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(typeGroup).getByRole('button', { name: '팀' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).getByLabelText(KEY_LABEL)).toBeInTheDocument()

    await user.click(within(typeGroup).getByRole('button', { name: '개인' }))
    expect(within(dialog).queryByLabelText(KEY_LABEL)).not.toBeInTheDocument()
  })

  // 공개 프로젝트 생성 payload 에 type=OPEN + key + name 이 실린다.
  test('공개 프로젝트를 만들면 POST 에 type=OPEN·key·name 이 실린다', async () => {
    const api = projectsApi([createProject()], createProject({ key: 'OPNQA', name: '공개 접수함', type: 'OPEN' }))
    const { user, dialog } = await openCreateDialog(api)
    await user.click(within(dialog).getByRole('button', { name: '공개' }))
    await user.type(within(dialog).getByLabelText(KEY_LABEL), 'OPNQA')
    await user.type(within(dialog).getByLabelText(NAME_LABEL), '공개 접수함')
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0]).toMatchObject({ type: 'OPEN', key: 'OPNQA', name: '공개 접수함' })
  })

  // 개인 프로젝트: key 는 보내지 않고(서버 자동) type=PERSONAL, 만든 뒤 목록 무효화로 사이드바 개인 섹션에 나타난다.
  test('개인 프로젝트를 만들면 key 없이 type=PERSONAL 로 보내고 사이드바 개인 섹션에 나타난다', async () => {
    const personal = createProject({ id: 7, key: 'PABC', name: '개인 작업', type: 'PERSONAL', isDefault: true })
    const api = projectsApi([], personal)
    const { user, dialog } = await openCreateDialog(api)
    await user.click(screen.getByTestId('project-type-PERSONAL'))
    expect(within(dialog).queryByLabelText(KEY_LABEL)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(NAME_LABEL), '개인 작업')
    await user.click(within(dialog).getByRole('button', { name: '생성' }))

    expect(await within(screen.getByTestId('sidebar-personal-projects')).findByText('개인 작업')).toBeInTheDocument()
    expect(screen.getByTestId('personal-project-PABC')).toBeInTheDocument()
    expect(api.posts).toHaveLength(1)
    expect(api.posts[0]).toMatchObject({ name: '개인 작업', type: 'PERSONAL' })
    expect(api.posts[0]).not.toHaveProperty('key')
  })

  // 팀 프로젝트 key 가 규칙(대문자/숫자 2~10자)에 어긋나면 zod 오류가 보이고 POST 는 나가지 않는다(deferred U5).
  test('팀 프로젝트 key 가 소문자면 유효성 오류를 보이고 생성 요청을 보내지 않는다', async () => {
    const api = projectsApi([])
    const { user, dialog } = await openCreateDialog(api)
    await user.type(within(dialog).getByLabelText(KEY_LABEL), 'abc')
    await user.type(within(dialog).getByLabelText(NAME_LABEL), '팀 프로젝트')
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    expect(await screen.findByText('대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다')).toBeInTheDocument()
    expect(api.posts).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: '새 프로젝트' })).toBeInTheDocument()
  })
})

describe('프로젝트 설정', () => {
  const settingsHandlers = (project: ProjectResponse) => [
    http.get(`${API}/projects/${project.key}`, () => HttpResponse.json(project)),
    http.get(`${API}/projects/${project.key}/members`, () => HttpResponse.json([createMember({ userId: 1 })])),
    ...projectScreen(project.key, { project }).handlers,
  ]

  // 개인 프로젝트 설정에는 멤버 관리 섹션이 없다.
  test('개인 프로젝트 설정에는 「멤버」 섹션이 없다', async () => {
    const personal = createProject({ id: 7, key: 'PABC', name: '개인 작업', type: 'PERSONAL', isDefault: true })
    renderPage('/projects/PABC/settings', { handlers: settingsHandlers(personal) })
    expect(await screen.findByRole('heading', { name: '프로젝트 설정' }, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '멤버' })).not.toBeInTheDocument()
  })

  // WP-929: 설명 2000자 초과 저장 — 칸 아래 오류(aria 연결)를 그리고 PATCH 는 보내지 않는다.
  test('설명이 2000자를 넘으면 오류 문구가 칸에 연결되어 보이고 저장 요청은 나가지 않는다', async () => {
    let patches = 0
    const project = createProject()
    const { user } = renderPage('/projects/WP/settings', {
      handlers: [
        ...settingsHandlers(project),
        http.patch(`${API}/projects/WP`, () => {
          patches++
          return HttpResponse.json(project)
        }),
      ],
    })
    await screen.findByRole('heading', { name: '프로젝트 설정' }, { timeout: PAGE_LOAD_TIMEOUT })
    const desc = await waitFor(() => {
      const el = document.querySelector<HTMLTextAreaElement>('#settings-desc')
      expect(el).not.toBeNull()
      return el!
    })
    await user.clear(desc)
    await user.click(desc)
    await user.paste('가'.repeat(2001))
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(document.querySelector('#settings-desc-error')).toHaveTextContent('설명은 2000자 이하여야 합니다'))
    expect(desc).toHaveAttribute('aria-invalid', 'true')
    expect(desc).toHaveAttribute('aria-describedby', 'settings-desc-error')
    expect(patches).toBe(0)
  })

  // 삭제 확인 → DELETE → 토스트(받침 없는 이름은 「가」, WP-647) → /projects 로 이동해 빈 상태가 보인다.
  test('프로젝트를 삭제하면 이름이 든 토스트가 뜨고 목록으로 돌아가 빈 상태가 보인다', async () => {
    let deleted = false
    const project = createProject({ name: '결제 테스트 프로젝트' })
    const { user, location } = renderPage('/projects/WP/settings', {
      handlers: [
        ...settingsHandlers(project),
        http.get(`${API}/projects`, () => HttpResponse.json(pageOf(deleted ? [] : [project]))),
        http.delete(`${API}/projects/WP`, () => {
          deleted = true
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    await user.click(await screen.findByTestId('project-delete', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    expect(await screen.findByText('프로젝트 "결제 테스트 프로젝트"가 삭제되었습니다')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/projects'))
    expect(await screen.findByTestId('projects-empty')).toHaveTextContent('아직 프로젝트가 없어요')
  })
})

describe('리소스 로드 실패 화면 (#787)', () => {
  const notFound = (key: string) =>
    http.get(`${API}/projects/${key}`, () => HttpResponse.json({ message: '프로젝트를 찾을 수 없습니다' }, { status: 404 }))

  // 404 프로젝트 — 아이콘(FolderX)·제목·설명·액션 버튼, 누르면 /projects 로 간다.
  test('없는 프로젝트는 아이콘·제목·설명·「프로젝트 목록으로」를 보이고 누르면 목록으로 간다', async () => {
    const { user, location, container } = renderPage('/projects/NOPROJECT999', { handlers: [notFound('NOPROJECT999')] })
    expect(await screen.findByText('프로젝트를 불러올 수 없습니다', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.getByText('요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다.')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-folder-x')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: '프로젝트 목록으로' }))
    await waitFor(() => expect(location()).toBe('/projects'))
  })

  // 프로젝트 자체 접근 불가인 이슈 경로 — 같은 패턴(아이콘은 FileQuestionMark).
  test('접근할 수 없는 프로젝트의 이슈 경로도 같은 오류 화면을 보이고 목록으로 돌아갈 수 있다', async () => {
    const { user, location, container } = renderPage('/projects/NOPROJECT999/issues/1', {
      handlers: [notFound('NOPROJECT999'), ...issueDetailScreen('NOPROJECT999', 1)],
    })
    expect(await screen.findByText('프로젝트를 불러올 수 없습니다', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.getByText('요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다.')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-file-question-mark')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: '프로젝트 목록으로' }))
    await waitFor(() => expect(location()).toBe('/projects'))
  })

  // 비멤버 403 도 같은 오류 제목을 보인다.
  test('비멤버 프로젝트(403)는 「프로젝트를 불러올 수 없습니다」를 보인다', async () => {
    renderPage('/projects/SECRET', {
      handlers: [http.get(`${API}/projects/SECRET`, () => HttpResponse.json({ status: 403, message: '프로젝트 멤버가 아닙니다' }, { status: 403 }))],
    })
    expect(await screen.findByText('프로젝트를 불러올 수 없습니다', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  })

  // WP-925: 이슈 번호가 숫자가 아니면 조회 없이 「이슈를 찾을 수 없습니다」 — 소용없는 「다시 시도」는 없다.
  test('이슈 번호가 숫자가 아니면 이슈 없음 화면이고 「다시 시도」가 없으며, 프로젝트로 돌아갈 수 있다', async () => {
    const { user, location } = renderPage('/projects/WP/issues/abc', {
      handlers: projectScreen('WP').handlers,
    })
    expect(await screen.findByText('이슈를 찾을 수 없습니다', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByText('태스크를 찾을 수 없습니다')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '프로젝트로 돌아가기' }))
    await waitFor(() => expect(location()).toBe('/projects/WP'))
  })
})
