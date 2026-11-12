// 프로젝트 설정(팀·개인, ProjectSettingsPage) — 매뉴얼 08장 도움말 연결 테스트(WP-1508).
// 섹션·대화상자가 맞는 도움말 절로 이어지는지, 개인 프로젝트는 같은 대표 절에 이름만 「개인 프로젝트 설정」으로 싣고
// 멤버 칸은 AI 어시스턴트 절로 잇는지, 화면 참고(AI)에 매뉴얼 설명이 실리는지, 응답 전에도 화면 이름이 실리는지를 본다.
// settingsGuideScreens.test.tsx 의 프로젝트 설정 부분에서 옮겼다(설정 가이드 대신 도움말).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'

import { currentScreenContext, withScreenContextProbe } from '@/test/kits/ai/ScreenContextProbe'
import { gate } from '@/test/kits/ai/testkit-b2a'
import { expectHelpTarget } from '@/test/kits/help/expectHelpTarget'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { atRoute } from '@/test/kits/projects/atRoute'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'
import type { IssueFieldDef } from '@/types/customField'
import type { MemberResponse, ProjectResponse } from '@/types/project'

import { createComponent } from '../../../e2e/factories/component.factory'
import { makeIssueType } from '../../../e2e/factories/issueType.factory'
import { createLabel } from '../../../e2e/factories/label.factory'
import { createAgentMember, createMember, createProject } from '../../../e2e/factories/project.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'
import ProjectSettingsPage from './ProjectSettingsPage'

const OWNER = createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })

/** 목록이 비지 않게 주는 값 — 라벨·유형·필드·구성요소(사용 중 1·보관 1) 각 하나. */
const FIELD: IssueFieldDef = {
  id: 1, projectId: 1, name: '고객사', type: 'TEXT', options: null, position: 1,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
}
const FULL_LISTS = {
  labels: [createLabel({ id: 1, name: '긴급' })],
  types: [makeIssueType({ id: 11, name: '디자인' })],
  fields: [FIELD],
  components: [createComponent({ id: 1, name: '결제' }), createComponent({ id: 2, name: '정산', archived: true })],
}

/** 프로젝트 설정 조회 — project 로 팀/개인을 고르고 members·lists 로 목록을 채운다. hold 를 주면 프로젝트 GET 을 그동안 붙든다. */
const projectHandlers = (
  project: ProjectResponse,
  extra: { members?: MemberResponse[]; lists?: Partial<typeof FULL_LISTS>; spaces?: unknown[]; hold?: Promise<void> } = {},
) => {
  const base = `/api/v1/projects/${project.key}`
  const lists = { labels: [], types: [], fields: [], components: [], ...extra.lists }
  return [
    http.get(base, async () => {
      if (extra.hold) await extra.hold
      return HttpResponse.json(project)
    }),
    http.get(`${base}/members`, () => HttpResponse.json(extra.members ?? [OWNER])),
    http.get(`${base}/member-groups`, () => HttpResponse.json([])),
    http.get(`${base}/labels`, () => HttpResponse.json(lists.labels)),
    http.get(`${base}/types`, () => HttpResponse.json(lists.types)),
    http.get(`${base}/fields`, () => HttpResponse.json(lists.fields)),
    http.get(`${base}/components`, () => HttpResponse.json(lists.components)),
    ...['cycles', 'milestones', 'versions', 'saved-views'].map((sub) => http.get(`${base}/${sub}`, () => HttpResponse.json([]))),
    http.get(`${base}/statuses`, () => HttpResponse.json(seedStatuses())),
    http.get(`${base}/issues/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
    http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
    http.get('/api/v1/shared-ai-memories/spaces', () => HttpResponse.json({ items: extra.spaces ?? [] })),
    // 소유자에게 보이는 「노트 공간」 영역(WP-1480)이 부르는 조회 — 공간 없음(404).
    http.get('/api/v1/wiki/project-spaces/:key', () => HttpResponse.json({ message: '노트 공간이 없습니다' }, { status: 404 })),
    // 멤버 제거 확인창이 부르는 담당 이슈 수 조회.
    http.get(`${base}/members/:userId/assigned-issue-count`, () => HttpResponse.json({ count: 0 })),
    // 라벨 삭제 확인창의 영향 안내가 부르는 조회.
    http.get(`${base}/labels/:id/issue-count`, () => HttpResponse.json({ count: 0 })),
    http.get(`${base}/issues`, () => HttpResponse.json({ content: [], page: 0, size: 1, totalElements: 0, totalPages: 0 })),
    // 「리포트」의 주간 리포트 줄(WP-1483) — 템플릿이 있고 관리할 수 있어 「기본으로 되돌리기」 확인창을 열 수 있다.
    http.get(`${base}/report-settings`, () =>
      HttpResponse.json({ enabled: true, cadence: 'WEEKLY', weekday: 'MONDAY', timeOfDay: '09:00', templatePageId: 321, nextRunAt: null, canManage: true }),
    ),
  ]
}

const screenOf = (el: React.ReactElement) => atRoute('/projects/:key/settings', el)
const heading = (name: string) => screen.getByRole('heading', { level: 2, name })

beforeEach(() => {
  server.use(...helpBundleHandlers(), ...shellHandlers)
})

describe('도움말 절 연결', () => {
  test('팀 프로젝트 — 섹션이 화면 순서대로 맞는 도움말 절로 이어진다', async () => {
    renderScreen(screenOf(<ProjectSettingsPage />), { path: '/projects/WP/settings', handlers: projectHandlers(createProject({ type: 'TEAM' }), { lists: FULL_LISTS }) })
    // 마지막으로 그려지는 섹션(위험 구역)까지 기다린다 — 멤버 목록을 받은 뒤에야 소유자 전용 섹션이 나온다.
    await screen.findByRole('heading', { level: 2, name: '위험 구역' })
    const pairs: [string, string][] = [
      ['기본 정보', 'basic'], ['연결된 저장소', 'repo'], ['멤버', 'members'], ['노트 공간', 'note-space'], ['상태', 'statuses'],
      ['라벨', 'labels'], ['구성요소', 'components'], ['이슈 유형', 'issue-types'], ['프로젝트 필드', 'fields'], ['리포트', 'report'], ['위험 구역', 'danger'],
    ]
    for (const [name, id] of pairs) expectHelpTarget(heading(name), `project-settings.${id}`)
  })

  test('접수함 프로젝트의 댓글 섹션, 공용 메모리 공간이 있는 팀 프로젝트의 AI 메모리 섹션도 자기 절로 이어진다', async () => {
    renderScreen(screenOf(<ProjectSettingsPage />), { path: '/projects/WP/settings', handlers: projectHandlers(createProject({ type: 'OPEN' })) })
    expectHelpTarget(await screen.findByRole('heading', { level: 2, name: '댓글' }), 'project-settings.comments')
  })

  test('공용 메모리 공간이 있으면 AI 메모리 섹션이 도움말 절로 이어진다', async () => {
    const space = { type: 'PROJECT', id: 1, key: 'WP', name: 'Workplace', label: 'Workplace(WP)', count: 1, limit: 50, canAdd: true, canManage: false }
    renderScreen(screenOf(<ProjectSettingsPage />), { path: '/projects/WP/settings', handlers: projectHandlers(createProject({ id: 1, type: 'TEAM' }), { spaces: [space] }) })
    expectHelpTarget(await screen.findByRole('heading', { level: 2, name: 'AI 메모리' }), 'project-settings.memory')
  })

  test('팀 프로젝트 — 대화상자가 자기 절로 이어진다', async () => {
    const members = [OWNER, createMember({ userId: 2, username: 'park', name: '박순', role: 'MEMBER' })]
    const { user } = renderScreen(screenOf(<ProjectSettingsPage />), {
      path: '/projects/WP/settings',
      handlers: projectHandlers(createProject({ type: 'TEAM' }), { members, lists: FULL_LISTS }),
    })
    await screen.findByRole('heading', { level: 2, name: '위험 구역' })
    /** 단추를 눌러 연 대화상자가 id 절로 이어지는지 보고 닫는다. */
    const check = async (button: HTMLElement, role: 'dialog' | 'alertdialog', id: string) => {
      await user.click(button)
      const dlg = await screen.findByRole(role)
      expectHelpTarget(dlg, id)
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole(role)).toBeNull())
    }
    await check(screen.getByRole('button', { name: '박순 제거' }), 'alertdialog', 'project-settings.members')
    await check(screen.getByRole('button', { name: '긴급 편집' }), 'dialog', 'project-settings.labels')
    await check(screen.getByRole('button', { name: '긴급 삭제' }), 'alertdialog', 'project-settings.labels')
    await check(screen.getByRole('button', { name: '디자인 편집' }), 'dialog', 'project-settings.issue-types')
    await check(screen.getByRole('button', { name: '디자인 삭제' }), 'alertdialog', 'project-settings.issue-types')
    await check(screen.getByRole('button', { name: '고객사 편집' }), 'dialog', 'project-settings.fields')
    await check(screen.getByRole('button', { name: '고객사 삭제' }), 'alertdialog', 'project-settings.fields')
    await check(screen.getByRole('button', { name: '결제 편집' }), 'dialog', 'project-settings.components')
    // 삭제는 보관한 구성요소에만 있다.
    await user.click(screen.getByTestId('component-archived-toggle'))
    await check(await screen.findByRole('button', { name: '정산 삭제' }), 'alertdialog', 'project-settings.components')
    await check(await screen.findByRole('button', { name: '기본으로 되돌리기' }), 'alertdialog', 'project-settings.report.reset')
    await check(screen.getByRole('button', { name: '프로젝트 삭제' }), 'alertdialog', 'project-settings.danger')
  })

  test('개인 프로젝트 — 멤버 칸과 제거 확인창은 AI 어시스턴트 절로', async () => {
    const members = [OWNER, createAgentMember({ userId: 99, name: '도우미' })]
    const { user } = renderScreen(screenOf(<ProjectSettingsPage />), {
      path: '/projects/WP/settings',
      handlers: projectHandlers(createProject({ type: 'PERSONAL' }), { members }),
    })
    expectHelpTarget(await screen.findByRole('heading', { level: 2, name: 'AI 어시스턴트' }), 'project-settings.assistants')
    expect(screen.queryByRole('heading', { level: 2, name: '멤버' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: '도우미 제거' }))
    expectHelpTarget(await screen.findByRole('alertdialog'), 'project-settings.assistants')
  })

  test('기본 개인 프로젝트 — 위험 구역은 지울 수 없다는 안내만 보이고 삭제 단추가 없다', async () => {
    renderScreen(screenOf(<ProjectSettingsPage />), {
      path: '/projects/WP/settings',
      handlers: projectHandlers(createProject({ type: 'PERSONAL', isDefault: true })),
    })
    const danger = (await screen.findByRole('heading', { level: 2, name: '위험 구역' })).closest('section')!
    expectHelpTarget(danger, 'project-settings.danger')
    expect(within(danger).getByText('처음부터 있던 기본 개인 프로젝트는 지울 수 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '프로젝트 삭제' })).toBeNull()
  })
})

// 설정 가이드 대신 매뉴얼 대표 절 요약(하위 절 포함)이 AI 화면 참고에 실린다.
describe('화면 참고', () => {
  test.each([
    ['팀 프로젝트', 'TEAM' as const, '설정 · 프로젝트 설정', '팀'],
    ['개인 프로젝트', 'PERSONAL' as const, '설정 · 개인 프로젝트 설정', '개인'],
  ])('%s — 화면 이름·화면 맥락(키·이름·종류)과 매뉴얼 설명이 실린다', async (_n, type, view, kind) => {
    renderScreen(screenOf(withScreenContextProbe(<ProjectSettingsPage />)), {
      path: '/projects/WP/settings',
      handlers: projectHandlers(createProject({ type })),
    })
    await screen.findByRole('heading', { level: 2, name: '기본 정보' })
    await waitFor(() => expect(currentScreenContext()?.scope?.facts).toContainEqual({ label: '소개', value: '프로젝트 설정 본문.' }))
    const ctx = currentScreenContext()!
    expect(ctx.view).toBe(view)
    // 개인 프로젝트도 같은 대표 절 요약을 받는다 — 하위 절(멤버)이 모두 실린다.
    expect(ctx.scope!.facts).toContainEqual({ label: '멤버 · 주의', value: '담당 비워짐 주의.' })
    expect(ctx.scope!.facts).toContainEqual({ label: '멤버', value: '멤버 본문.' })
    await waitFor(() => expect(currentScreenContext()?.focus).toMatchObject({ type: '프로젝트', label: 'Workplace', refs: { projectKey: 'WP' } }))
    expect(currentScreenContext()!.focus!.facts).toContainEqual({ label: '종류', value: kind })
  })
})

describe('로딩 중', () => {
  test('프로젝트를 받기 전에는 「설정 · 프로젝트 설정」 — 개인이면 받은 뒤 이름이 바뀐다', async () => {
    const held = gate()
    renderScreen(screenOf(withScreenContextProbe(<ProjectSettingsPage />)), {
      path: '/projects/WP/settings',
      handlers: projectHandlers(createProject({ type: 'PERSONAL' }), { hold: held.p }),
    })
    await waitFor(() => expect(currentScreenContext()?.view).toBe('설정 · 프로젝트 설정'))
    expect(screen.queryByRole('heading', { level: 2, name: '기본 정보' })).not.toBeInTheDocument()
    held.release()
    expect(await screen.findByRole('heading', { level: 2, name: '기본 정보' })).toBeInTheDocument()
    await waitFor(() => expect(currentScreenContext()?.view).toBe('설정 · 개인 프로젝트 설정'))
  })
})
