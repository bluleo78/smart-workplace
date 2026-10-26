// 드라이브 화면 테스트 공용 MSW 스텁(WP-984, WP-966 웨이브 3) — e2e/fixtures/drive-mock.ts 의 vitest 판.
// 드라이브 E2E 에서 옮긴 화면 테스트(DrivePage·DriveSidebar·DriveAttachmentsView)가 공간·목록·쿼터·파일별 콘텐츠/요약/참조된 곳 응답을 같은 모양으로 쓴다.
// 데이터는 E2E 와 같은 팩토리(e2e/factories/drive.factory)로 만든다.
import { http, HttpResponse, type RequestHandler } from 'msw'
import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import type { AuthContextValue } from '@/hooks/auth-context-value'
import { DrivePage } from '@/pages/drive/DrivePage'
import { renderScreen } from '@/test/renderScreen'
import type { DriveFile, DriveFolder, DriveSpace } from '@/types/drive'

import { createSpace, personalSpace } from '../../../e2e/factories/drive.factory'

export const API = '/api/v1/drive'

/**
 * 드라이브 화면 기본 조회 — 공간 목록·공간 하나·쿼터·공간 목록 항목(folders/files).
 * items 는 함수로 주면 요청(URL)마다 다시 계산한다(folderId 별 목록·저장 뒤 재조회 반영).
 */
export function driveBaseHandlers({
  spaces = [personalSpace(), createSpace()],
  items = { folders: [], files: [] },
  quota = { usedBytes: 0, quotaBytes: 10 * 1024 * 1024 * 1024 },
}: {
  spaces?: DriveSpace[]
  items?: { folders: DriveFolder[]; files: DriveFile[] } | ((url: URL) => { folders: DriveFolder[]; files: DriveFile[] })
  quota?: { usedBytes: number; quotaBytes: number }
} = {}): RequestHandler[] {
  return [
    http.get(`${API}/spaces`, () => HttpResponse.json(spaces)),
    http.get(`${API}/spaces/:id`, ({ params }) =>
      HttpResponse.json(spaces.find((s) => String(s.id) === params.id) ?? spaces[0]),
    ),
    http.get(`${API}/spaces/:id/items`, ({ request }) =>
      HttpResponse.json(typeof items === 'function' ? items(new URL(request.url)) : items),
    ),
    http.get(`${API}/quota`, () => HttpResponse.json(quota)),
  ]
}

/** 파일 하나의 미리보기 부속 조회 — 썸네일(404)·요약·참조된 곳. 콘텐츠는 테스트마다 준다. */
export function fileSideHandlers(
  id: number,
  { summary = { summary: null, status: 'PENDING' }, backlinks = [] }: { summary?: Record<string, unknown> | number; backlinks?: Record<string, unknown>[] } = {},
): RequestHandler[] {
  return [
    http.get(`${API}/files/${id}/thumbnail`, () => new HttpResponse(null, { status: 404 })),
    http.get(`${API}/files/${id}/summary`, () =>
      typeof summary === 'number' ? new HttpResponse(null, { status: summary }) : HttpResponse.json(summary),
    ),
    http.get(`${API}/files/${id}/backlinks`, () => HttpResponse.json(backlinks)),
  ]
}

/**
 * 드라이브 공간 화면을 앱과 같은 풀페이지 모드로 띄운다 — 라우트 /drive/spaces/:spaceId(useParams·?folderId·?preview 를 주소로 읽음).
 * spaceId prop 을 주면 채널 드로워용 임베드 모드(filesFolder 키)가 되므로 쓰지 않는다. 미리보기가 AI 진입점(useAssistant)을 쓰므로
 * 앱 셸(AppLayout)이 까는 AIAssistantProvider 만 함께 감싼다(단축키 끔). extra 는 같은 트리에 함께 그릴 컴포넌트(사이드바 등).
 */
export function renderDrivePage(
  spaceId: number,
  {
    search = '',
    handlers = [],
    auth,
    extra,
  }: { search?: string; handlers?: RequestHandler[]; auth?: Partial<AuthContextValue>; extra?: ReactNode } = {},
) {
  return renderScreen(
    <AIAssistantProvider hotkeysEnabled={false}>
      {extra}
      <Routes>
        <Route path="/drive/spaces/:spaceId" element={<DrivePage />} />
        <Route path="*" element={null} />
      </Routes>
    </AIAssistantProvider>,
    { path: `/drive/spaces/${spaceId}${search}`, handlers, auth },
  )
}
