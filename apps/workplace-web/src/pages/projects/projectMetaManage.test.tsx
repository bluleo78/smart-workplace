// 마일스톤·사이클 관리 권한(WP-1008) — 페이지 테스트(WP-971).
// 서버가 마일스톤·사이클 변경을 버전처럼 프로젝트 OWNER(·테넌트 ADMIN)만 허락하므로, OWNER 가 아닌 멤버에게는
// 사이클 화면의 새 사이클·수정·삭제를 그리지 않는다(타임라인 마일스톤은 timeline/timelineMilestoneManage.test.tsx). 훅을 끊지 않고 MSW 로 실제 api → 훅 → 화면을 지난다.
import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { projectMetaHandlers, settleMembers } from '@/test/msw/projectMetaHandlers'
import { KEY, OWNER_MEMBERS, PLAIN_MEMBERS } from '@/test/msw/versionHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { MemberResponse } from '@/types/project'

describe('사이클 화면 — 관리 권한', () => {
  async function openCycles(members: MemberResponse[]) {
    const view = renderPage(`/projects/${KEY}/cycles`, { handlers: projectMetaHandlers(members) })
    expect(await screen.findByTestId('cycle-row-1', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('스프린트 1')
    await settleMembers(view)
    return view
  }

  test('OWNER 는 새 사이클·수정·삭제가 보인다(양성 대조)', async () => {
    await openCycles(OWNER_MEMBERS)
    expect(await screen.findByTestId('cycle-new')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '스프린트 1 수정' })).toBeInTheDocument()
    expect(screen.getByTestId('cycle-delete-1')).toBeInTheDocument()
  })

  test('OWNER 가 아닌 멤버는 목록만 본다 — 새 사이클·수정·삭제가 없다', async () => {
    await openCycles(PLAIN_MEMBERS)
    expect(screen.queryByTestId('cycle-new')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '스프린트 1 수정' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('cycle-delete-1')).not.toBeInTheDocument()
  })
})
