// 프로젝트 설정 「위험 구역」의 기본 개인 프로젝트 삭제 안내(WP-857) — 화면 테스트(WP-980, WP-1002 에서 설정 화면만 띄우게 바꿈).
// 기본 프로젝트면 삭제 버튼 대신 이유 안내, 일반 프로젝트면 확인창 문구(조사·설명)는 조건부 렌더·문구라
// 브라우저 없이 판정되므로 e2e/pages/projects/project-delete-default.spec.ts 에서 옮겼다(그 spec 은 모두 옮겨 지웠다).
import { screen } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import ProjectSettingsPage from '@/pages/projects/ProjectSettingsPage'
import { projectSettingsHandlers } from '@/test/kits/projects/issueDetailStubs'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'

import { createMember, createProject } from '../../../e2e/factories/project.factory'

const OWNER = [createMember({ userId: 1, role: 'OWNER' })]

/** 설정 화면(ProjectSettingsPage)만 띄운다 — 위험 구역은 화면 안에 직접 그려진다. 섹션들의 부가 조회는 셸 기본값이 받는다. */
const renderSettings = (path: string, handlers: RequestHandler[]) =>
  renderScreen(
    <Routes>
      <Route path="/projects/:key/settings" element={<ProjectSettingsPage />} />
    </Routes>,
    { path, handlers: [...handlers, ...shellHandlers] },
  )

test('기본 개인 프로젝트는 삭제 버튼 대신 지울 수 없다는 안내가 미리 보인다', async () => {
  const project = createProject({ key: 'P1', name: '내 프로젝트', type: 'PERSONAL', isDefault: true })
  renderSettings('/projects/P1/settings', projectSettingsHandlers(project, OWNER))
  // 위험 구역(소유자에게만 보임)은 남아 이유를 알리고, 누르면 409 로 거절될 삭제 버튼은 없다.
  expect(await screen.findByRole('heading', { name: '위험 구역' })).toBeInTheDocument()
  expect(screen.getAllByText('처음부터 있던 기본 개인 프로젝트는 지울 수 없어요.').length).toBeGreaterThan(0)
  expect(screen.queryByTestId('project-delete')).not.toBeInTheDocument()
  expect(screen.queryByText('프로젝트를 삭제하면 이슈와 코멘트도 함께 숨겨져요.')).not.toBeInTheDocument()
})

test('일반 개인 프로젝트는 삭제할 수 있고, 확인창은 「프로젝트를」로 맺으며 함께 숨겨진다고 알린다', async () => {
  const project = createProject({ key: 'P2', name: '사이드 프로젝트', type: 'PERSONAL', isDefault: false })
  const { user } = renderSettings('/projects/P2/settings', projectSettingsHandlers(project, OWNER))
  const button = await screen.findByTestId('project-delete')
  expect(button).toBeEnabled()
  expect(screen.getByText('프로젝트를 삭제하면 이슈와 코멘트도 함께 숨겨져요.')).toBeInTheDocument()
  await user.click(button)
  expect(await screen.findByRole('alertdialog')).toHaveTextContent(
    '「사이드 프로젝트」(P2) 프로젝트를 삭제할까요? 이슈와 코멘트도 함께 숨겨지고, 화면에서 되돌릴 수 없어요.',
  )
})
