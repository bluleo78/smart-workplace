// 드라이브 행 액션 — 터치 태블릿(≥1024px, WP-237) 페이지 테스트(WP-971).
// 폭은 데스크톱이라 길게 누르기 선택 모드가 없고 체크박스로 고른다 — 골라도 ⋯ 가 남고 행 탭은 미리보기를 연다.
// 이 판정은 브라우저 없이 되므로 e2e/pages/mobile/drive-row-actions.spec.ts 에서 옮겼다(파일 하나는 뷰포트 하나라 휴대폰 파일과 나눈다).
// ⋯ 드롭다운의 다운로드·44px(@layout)와 이름 변경 다이얼로그 포커스 유지(@input)는 E2E 에 남는다.
// 앱 셸을 보지 않으므로 드라이브 모듈 레이아웃과 공간 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { DriveModuleLayout } from '@/components/drive/DriveModuleLayout'
import { renderMobileScreen } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { createFile, createFolder, createSpace, personalSpace } from '../../../e2e/factories/drive.factory'
import { DrivePage } from '../drive/DrivePage'

// E2E 태블릿 프로젝트와 같은 1180×820 터치(coarse) 뷰포트.
mockViewport({ width: 1180, height: 820, pointer: 'coarse' })

const SPACE_ID = 1

/** 드라이브 공간 화면을 모듈 레이아웃과 함께 띄운다. */
function renderDrive(handlers: RequestHandler[]) {
  return renderMobileScreen(
    <Routes>
      <Route element={<DriveModuleLayout />}>
        <Route path="/drive/spaces/:spaceId" element={<DrivePage />} />
      </Route>
    </Routes>,
    { path: `/drive/spaces/${SPACE_ID}`, handlers },
  )
}
const LONG_FILE = '2026_하반기_스마트워크플레이스_도입제안서_최종_검토반영_v3_고객사송부본.pdf'
const FOLDER = createFolder({ id: 10, name: '고객사별 견적 및 계약 검토 자료' })
const FILE = createFile({ id: 70, name: LONG_FILE, mimeType: 'application/pdf', category: 'PDF', sizeBytes: 4_400_000 })

const handlers = [
  http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 })),
  http.get('/api/v1/drive/spaces', () => HttpResponse.json([personalSpace(), createSpace()])),
  http.get(`/api/v1/drive/spaces/${SPACE_ID}`, () => HttpResponse.json(createSpace())),
  http.get(`/api/v1/drive/spaces/${SPACE_ID}/items`, () => HttpResponse.json({ folders: [FOLDER], files: [FILE] })),
  // 썸네일·미리보기 부가 조회 — 이 테스트는 내용을 보지 않으므로 없음으로 둔다.
  http.get('/api/v1/drive/files/:id/:sub', () => new HttpResponse(null, { status: 404 })),
]

// 체크박스 선택이 ⋯ 를 감추면 태블릿에서 행 작업에 닿을 길이 없고, 행 탭이 선택으로 새면 파일을 못 연다.
test('체크박스로 선택해도 ⋯ 는 남고, 행 탭은 미리보기를 연다(길게 누르기 선택 모드 없음)', async () => {
  const { user, location } = renderDrive(handlers)
  await user.click(await screen.findByTestId('select-folder-10'))
  expect(await screen.findByTestId('bulk-toolbar')).toHaveTextContent('선택 1개')
  expect(screen.getByTestId('drive-row-more-file-70')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: LONG_FILE }))
  await waitFor(() => expect(location()).toBe(`/drive/spaces/${SPACE_ID}?preview=70`))
})
