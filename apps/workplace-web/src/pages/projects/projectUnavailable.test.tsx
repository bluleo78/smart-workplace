// 프로젝트 접근 불가 화면(WP-480) — 페이지 테스트(WP-980).
// 비멤버가 URL 로 설정·사이클·타임라인을 열어 API 가 403 이면 빈 관리 화면 대신 안내를 보이는지는 API 오류 → 화면 분기라
// 브라우저 없이 판정되므로 e2e/pages/projects/project-unavailable.spec.ts 에서 옮겼다(그 spec 은 모두 옮겨 지웠다).
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

const KEY = 'SEC'

test.each(['settings', 'cycles', 'timeline'])('비멤버가 /projects/SEC/%s 를 열면 접근 불가 안내를 보인다', async (path) => {
  // 프로젝트와 그 하위 API 는 모두 403(비멤버) — 기본 셸 핸들러(빈 목록)보다 먼저 잡는다.
  renderPage(`/projects/${KEY}/${path}`, {
    handlers: [
      http.all(`/api/v1/projects/${KEY}`, () => HttpResponse.json({ message: '프로젝트 멤버가 아닙니다' }, { status: 403 })),
      http.all(`/api/v1/projects/${KEY}/*`, () => HttpResponse.json({ message: '프로젝트 멤버가 아닙니다' }, { status: 403 })),
    ],
  })
  expect(await screen.findByText('프로젝트를 불러올 수 없습니다', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '프로젝트 목록으로' })).toBeInTheDocument()
  expect(screen.queryByTestId('project-delete')).not.toBeInTheDocument()
  expect(screen.queryByTestId('member-add-trigger')).not.toBeInTheDocument()
  expect(screen.queryByText('아직 사이클이 없습니다')).not.toBeInTheDocument()
})
