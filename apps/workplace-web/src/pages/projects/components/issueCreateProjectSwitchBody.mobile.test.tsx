// 프로젝트를 고르는 새 이슈 휴대폰 시트(WP-1768) — 시트 안에서 프로젝트를 A→B 로 바꾸면 설명 칸이 B 설정으로 다시 마운트돼야 한다.
// 데스크톱(issueCreateProjectSwitchBody.test.tsx)과 같은 것을 본다 — 모바일은 이미지 버튼이 없어 붙여넣기로 넣는다.
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { pasteInto, projectSwitchApi } from '@/test/kits/projects/issueCreateProjectSwitch'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { IssueCreateDialog } from './IssueCreateDialog'

mockViewport()

// 칸 안 <img> 의 인증 요청은 끊고 고정 blob 주소를 준다 — 그림으로 그려졌는지만 본다.
vi.mock('@/hooks/queries/useApiBlobUrl', () => ({
  useApiBlobUrl: (path: string | null | undefined) => ({ url: path ? 'blob:fixed' : null, isError: false, blob: null }),
}))

test('휴대폰 시트도 프로젝트를 바꾼 뒤 붙여넣은 이미지는 새 프로젝트로 올라가 그림·원문에 남고, 설명 글이 남으며 잠금은 새 프로젝트 기준이다', async () => {
  const api = projectSwitchApi()
  const { user } = renderScreen(<IssueCreateDialog projectKey="" selectProject open onOpenChange={() => {}} />, { handlers: api.handlers })
  const sheet = await screen.findByTestId('issue-create-sheet', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  const field = () => within(sheet).getByRole('combobox', { name: '프로젝트' })
  const body = () => within(sheet).getByTestId('issue-create-body')
  expect(field()).toHaveTextContent('알파 팀')
  await user.type(within(sheet).getByTestId('issue-create-title'), '베타 일')
  pasteInto(body(), { text: '메모 ' })
  await waitFor(() => expect(body()).toHaveTextContent('메모'))

  await user.click(field())
  await user.click(await screen.findByRole('option', { name: '베타 팀' }))
  await waitFor(() => expect(field()).toHaveTextContent('베타 팀'))
  await waitFor(() => expect(body()).toHaveTextContent('메모'))
  // 알파 이미지 주소는 이제 잠그지 않는다 — 잠금은 베타 이미지 기준.
  pasteInto(body(), { text: '![old.png](/api/v1/projects/ALPHA/issue-images/3)' })
  await waitFor(() => expect(body()).toHaveTextContent('old.png'))
  expect(field()).toBeEnabled()

  pasteInto(body(), { file: new File(['x'], 'shot.png', { type: 'image/png' }) })
  await waitFor(() => expect(api.uploads).toEqual(['BETA']))
  await waitFor(() => expect(body().querySelector('img')).not.toBeNull())
  await waitFor(() => expect(field()).toBeDisabled())

  await user.click(within(sheet).getByTestId('issue-create-submit'))
  await waitFor(() => expect(api.created).toHaveLength(1))
  expect(api.created[0].key).toBe('BETA')
  expect(api.created[0].body).toContain('메모')
  expect(api.created[0].body).toContain('![shot.png](/api/v1/projects/BETA/issue-images/8)')
})
