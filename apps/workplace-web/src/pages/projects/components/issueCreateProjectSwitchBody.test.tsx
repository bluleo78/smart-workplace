// 프로젝트를 고르는 새 이슈 창(WP-1768) — 창 안에서 프로젝트를 A→B 로 바꾸면 본문 칸이 B 설정으로 다시 마운트돼야 한다.
// 편집칸은 본문 모드 설정(이미지 노드·업로드 경로·붙여넣기 판정)을 마운트 때 한 번만 정하므로, 다시 마운트하지 않으면 B 로 올린 이미지가
// 그림으로 안 보이거나 원문에서 빠진다. 바꾼 뒤에도 본문 글은 남고, 이미지는 B 경로로 올라가 그림·원문에 남으며 잠금도 B 이미지 기준인지 본다.
// 모바일 시트는 issueCreateProjectSwitchBody.mobile.test.tsx(뷰포트가 파일당 하나).
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { renderScreen } from '@/test/renderScreen'

import { IssueCreateDialog } from './IssueCreateDialog'
import { pasteInto, projectSwitchApi } from './issueCreateProjectSwitchKit'

// 칸 안 <img> 의 인증 요청은 끊고 고정 blob 주소를 준다 — 그림으로 그려졌는지만 본다.
vi.mock('@/hooks/queries/useApiBlobUrl', () => ({
  useApiBlobUrl: (path: string | null | undefined) => ({ url: path ? 'blob:fixed' : null, isError: false, blob: null }),
}))

test('프로젝트를 바꾼 뒤 넣은 이미지는 새 프로젝트로 올라가 그림·원문에 남고, 본문 글이 남으며 잠금은 새 프로젝트 기준이다', async () => {
  const api = projectSwitchApi()
  const { user } = renderScreen(<IssueCreateDialog projectKey="" selectProject open onOpenChange={() => {}} />, { handlers: api.handlers })
  const title = await screen.findByLabelText(/제목/, {}, { timeout: SCREEN_LOAD_TIMEOUT })
  const dialog = title.closest<HTMLElement>('[role="dialog"]')!
  const field = () => within(dialog).getByRole('combobox', { name: '프로젝트' })
  expect(field()).toHaveTextContent('알파 팀')
  await user.type(title, '베타 일')
  pasteInto(within(dialog).getByTestId('issue-body'), { text: '메모 ' })
  await waitFor(() => expect(within(dialog).getByTestId('issue-body')).toHaveTextContent('메모'))

  await user.click(field())
  await user.click(await screen.findByRole('option', { name: '베타 팀' }))
  await waitFor(() => expect(field()).toHaveTextContent('베타 팀'))
  // 다시 마운트된 칸에도 앞서 쓴 본문 글이 남는다.
  await waitFor(() => expect(within(dialog).getByTestId('issue-body')).toHaveTextContent('메모'))
  // 다른 프로젝트(알파) 이미지 주소는 이제 잠그지 않는다 — 잠금은 베타 이미지 기준.
  pasteInto(within(dialog).getByTestId('issue-body'), { text: '![old.png](/api/v1/projects/ALPHA/issue-images/3)' })
  await waitFor(() => expect(within(dialog).getByTestId('issue-body')).toHaveTextContent('old.png'))
  expect(field()).toBeEnabled()

  await user.upload(within(dialog).getByTestId('issue-body-image-input'), new File(['x'], 'shot.png', { type: 'image/png' }))
  // 베타 업로드 경로로 올라가고, 칸 안에 그림으로 그려지며, 프로젝트 칸이 잠긴다.
  await waitFor(() => expect(api.uploads).toEqual(['BETA']))
  await waitFor(() => expect(within(dialog).getByTestId('issue-body').querySelector('img')).not.toBeNull())
  await waitFor(() => expect(field()).toBeDisabled())

  await user.click(within(dialog).getByRole('button', { name: '생성' }))
  await waitFor(() => expect(api.created).toHaveLength(1))
  expect(api.created[0].key).toBe('BETA')
  expect(api.created[0].body).toContain('메모')
  expect(api.created[0].body).toContain('![shot.png](/api/v1/projects/BETA/issue-images/8)')
})
