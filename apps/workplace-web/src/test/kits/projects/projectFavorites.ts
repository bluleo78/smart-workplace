// 프로젝트 즐겨찾기(WP-1001) MSW 목 — 서버처럼 key 집합을 가진다. 화면 테스트(renderScreen)는 앱 셸 기본 핸들러를 깔지 않으므로,
// 즐겨찾기를 읽는 화면(사이드바·프로젝트 목록)을 띄울 때 이 핸들러를 넘긴다. 이 테스트 동안만 쓰는 새 집합이다.
import { http, HttpResponse } from 'msw'

const API = '/api/v1'

/** initial 키를 가진 즐겨찾기 목. keys() 는 지금 서버에 있는 키, requests 는 받은 쓰기 요청(PUT·DELETE `KEY`)이다. */
export function projectFavoriteHandlers(initial: string[] = []) {
  const keys = new Set(initial)
  const requests: string[] = []
  const body = () => HttpResponse.json({ projectKeys: [...keys] })
  const handlers = [
    http.get(`${API}/me/project-favorites`, body),
    http.put(`${API}/me/project-favorites/:key`, ({ params }) => {
      requests.push(`PUT ${String(params.key)}`)
      keys.add(String(params.key))
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${API}/me/project-favorites/:key`, ({ params }) => {
      requests.push(`DELETE ${String(params.key)}`)
      keys.delete(String(params.key))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/me/project-favorites/import`, async ({ request }) => {
      for (const k of ((await request.json()) as { projectKeys: string[] }).projectKeys) keys.add(k)
      return body()
    }),
  ]
  return { handlers, keys: () => [...keys], requests }
}
