// 이슈 관계(WP-887) 페이지 테스트용 MSW 어댑터(WP-980) — E2E 의 상태 있는 모킹 서버(e2e/fixtures/issueRelationServer.ts)를
// 그대로 저장소로 쓰고, page.route 대신 MSW 핸들러로 같은 경로를 잇는다. 응답 규칙(관계 줄의 말·side·이력)은 서버 클래스가 정한다.
import { http, HttpResponse, type RequestHandler } from 'msw'

import type { AddIssueRelationRequest, SaveIssueExternalLinkRequest } from '@/types/issue'

import { systemTypes } from '../../../../e2e/factories/issueType.factory'
import { IssueRelationServer } from '../../../../e2e/fixtures/issueRelationServer'

export { IssueRelationServer }

type Ref = { projectKey: string; number: number }
// 서버 클래스의 저장소 연산 — 클래스 안에서만 쓰도록 private 이지만 같은 규칙을 재사용하려 꺼내 부른다.
type Internals = {
  detailOf(ref: Ref): unknown
  addRelation(from: Ref, body: AddIssueRelationRequest): void
  pushHistory(owner: Ref, eventType: string, from: unknown, to: unknown): void
}

/** server 의 상태를 MSW 로 노출한다 — 프로젝트·멤버·유형·라벨 같은 상세 부가 조회도 포함. */
export function relationHandlers(server: IssueRelationServer): RequestHandler[] {
  const s = server as unknown as Internals
  const ref = (params: Record<string, unknown>): Ref => ({ projectKey: String(params.key), number: Number(params.n) })
  return [
    http.get('/api/v1/projects/:key', ({ params }) =>
      HttpResponse.json({ id: 1, key: params.key, name: params.key, description: '', ownerId: 1, ownerName: 'T', createdAt: '', updatedAt: '' }),
    ),
    http.get('/api/v1/projects/:key/members', () => HttpResponse.json([{ userId: 1, username: 'me', name: 'Me', role: 'OWNER' }])),
    http.get('/api/v1/projects/:key/types', () => HttpResponse.json(systemTypes())),
    http.get('/api/v1/projects/:key/labels', () => HttpResponse.json([])),
    http.get('/api/v1/projects/:key/issues', () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    http.get('/api/v1/projects/:key/issues/:n/:sub', ({ params }) =>
      ['watchers', 'attachments', 'drive-links'].includes(String(params.sub)) ? HttpResponse.json([]) : undefined,
    ),
    http.get('/api/v1/issues/:id/comments', () => HttpResponse.json([])),
    http.get('/api/v1/drive/spaces', () => HttpResponse.json([])),
    http.get('/api/v1/issue-relation-types', () => HttpResponse.json(server.types)),
    http.get('/api/v1/issues/lookup', () => HttpResponse.json(server.lookupItems)),
    http.get('/api/v1/projects/:key/issues/:n', ({ params }) => {
      const r = ref(params)
      if (!server.titles.has(`${r.projectKey}-${r.number}`)) return HttpResponse.json({ message: 'not found' }, { status: 404 })
      return HttpResponse.json(s.detailOf(r) as never)
    }),
    http.post('/api/v1/projects/:key/issues/:n/relations', async ({ params, request }) => {
      const from = ref(params)
      if (server.failNextRelationPost) {
        const e = server.failNextRelationPost
        server.failNextRelationPost = null
        return HttpResponse.json({ message: e.message, errors: e.code ? { code: e.code } : undefined }, { status: e.status })
      }
      s.addRelation(from, (await request.json()) as AddIssueRelationRequest)
      return HttpResponse.json(server.relationsOf(from))
    }),
    http.delete('/api/v1/projects/:key/issues/:n/relations/:id', ({ params }) => {
      const id = Number(params.id)
      const rel = server.relations.find((x) => x.id === id)
      if (rel) {
        for (const owner of [rel.source, rel.target]) {
          const mine = server.relationsOf(owner).find((x) => x.id === id)!
          const other = owner === rel.source ? rel.target : rel.source
          s.pushHistory(owner, 'RELATION_REMOVED', null, {
            typeId: rel.typeId,
            label: mine.label,
            other: { projectKey: other.projectKey, number: other.number, title: server.titles.get(`${other.projectKey}-${other.number}`) },
          })
        }
        server.relations = server.relations.filter((x) => x.id !== id)
      }
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/v1/projects/:key/issues/:n/external-links', async ({ params, request }) => {
      const owner = ref(params)
      const body = (await request.json()) as SaveIssueExternalLinkRequest
      const type = server.types.find((t) => t.id === body.typeId)!
      server.externals.push({
        owner, id: 900 + server.externals.length, typeId: type.id, typeCode: type.code,
        label: body.side === 'target' ? (type.inwardLabel ?? type.outwardLabel) : type.outwardLabel,
        side: type.directed && body.side === 'target' ? 'target' : 'source',
        url: body.url ?? '', key: body.key ?? null, title: body.title,
      })
      return HttpResponse.json(server.externalsOf(owner))
    }),
    http.put('/api/v1/projects/:key/issues/:n/external-links/:id', async ({ params, request }) => {
      const owner = ref(params)
      const body = (await request.json()) as SaveIssueExternalLinkRequest
      const e = server.externals.find((x) => x.id === Number(params.id))
      if (e) {
        const type = server.types.find((t) => t.id === body.typeId)!
        e.typeId = type.id
        e.typeCode = type.code
        e.label = body.side === 'target' ? (type.inwardLabel ?? type.outwardLabel) : type.outwardLabel
        if (body.side) e.side = type.directed && body.side === 'target' ? 'target' : 'source'
        e.key = body.key ?? null
        e.title = body.title
      }
      return HttpResponse.json(server.externalsOf(owner))
    }),
    http.delete('/api/v1/projects/:key/issues/:n/external-links/:id', ({ params }) => {
      server.externals = server.externals.filter((x) => x.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}
