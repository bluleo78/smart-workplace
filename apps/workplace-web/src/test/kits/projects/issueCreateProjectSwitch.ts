// 프로젝트를 고르는 새 이슈 창의 본문 칸 테스트(WP-1768) 공용 — 데스크톱·모바일 테스트 파일
// (pages/projects/components/issueCreateProjectSwitchBody*.test.tsx)이 함께 쓴다.
import { act, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { createIssue } from '../../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../../e2e/factories/issueType.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

/** 개인 프로젝트는 고를 수 없어 첫 팀 프로젝트(알파)가 처음 값이다. */
const PROJECTS = [
  createProject({ id: 1, key: 'ME', name: '내 일', type: 'PERSONAL', isDefault: true }),
  createProject({ id: 3, key: 'ALPHA', name: '알파 팀' }),
  createProject({ id: 4, key: 'BETA', name: '베타 팀' }),
]

/** 알파 프로젝트에만 있는 구성원 — 멘션 이름표가 프로젝트를 바꾼 뒤에도 남는지 본다(베타 멤버 목록에는 없다). */
export const ALPHA_MEMBER = { userId: 7, username: 'kim', name: '김개발', kind: 'HUMAN' as const }

/** 창이 부르는 API — 이미지 업로드는 올린 프로젝트 키를 uploads 에, 만들기는 키·본문을 created 에 모은다. 업로드는 바로 끝난다. */
export function projectSwitchApi() {
  const uploads: string[] = []
  const created: { key: string; body?: string }[] = []
  const handlers = [
    http.get('/api/v1/projects', () =>
      HttpResponse.json({ content: PROJECTS, page: 0, size: 100, totalElements: PROJECTS.length, totalPages: 1 }),
    ),
    http.get('/api/v1/projects/:key/types', () => HttpResponse.json(systemTypes())),
    http.post('/api/v1/projects/:key/issue-images', ({ params }) => {
      const key = String(params.key)
      uploads.push(key)
      return HttpResponse.json({ fileId: 8, url: `/api/v1/projects/${key}/issue-images/8`, name: 'shot.png', mimeType: 'image/png', size: 1 })
    }),
    http.get('/api/v1/projects/:key/members', ({ params }) => HttpResponse.json(params.key === 'ALPHA' ? [ALPHA_MEMBER] : [])),
    http.get('/api/v1/projects/:key/:sub', () => HttpResponse.json([])),
    http.get('/api/v1/projects/:key', ({ params }) => HttpResponse.json(PROJECTS.find((p) => p.key === params.key))),
    http.post('/api/v1/projects/:key/issues', async ({ params, request }) => {
      const body = (await request.json()) as { body?: string }
      created.push({ key: String(params.key), body: body.body })
      return HttpResponse.json(createIssue({ id: 1, number: 1, projectKey: String(params.key) }), { status: 201 })
    }),
  ]
  return { handlers, uploads, created }
}

/** 본문 칸에 붙여넣는다 — 글자(text) 또는 이미지 파일(file). */
export function pasteInto(el: HTMLElement, data: { text?: string; file?: File }) {
  const clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? data.text ?? '' : ''),
    types: data.file ? ['Files'] : ['text/plain'],
    files: (data.file ? [data.file] : []) as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
  }
  act(() => {
    fireEvent.paste(el, { clipboardData })
  })
}
