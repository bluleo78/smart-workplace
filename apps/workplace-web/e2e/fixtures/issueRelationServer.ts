// 이슈 관계(WP-887) E2E 용 상태 있는 모킹 서버 — 이슈 상세·관계·외부 링크·관계 대상 찾기를 한 군데서 흉내 낸다.
// 왜 상태를 가지나: 관계는 두 이슈에 동시에 걸리고 방향 있는 유형은 양쪽 말이 다르다. 한쪽에 건 뒤 반대쪽 상세에
// 「결과임」이 보이는지 같은 "서버 응답을 따르는 화면"을 검증하려면 저장소 역할을 하는 모킹이 필요하다.
// 요청 기록(몇 번·무슨 본문)은 여기가 아니라 trackRequests 가 맡는다.
import type { Page, Route } from '@playwright/test'

import type {
  AddIssueRelationRequest,
  IssueExternalLinkView,
  IssueHistoryEntry,
  IssueLookupItem,
  IssueRelationType,
  IssueRelationView,
  SaveIssueExternalLinkRequest,
} from '../../src/types/issue'
import { createHistoryEntry, createIssue, createIssueDetail } from '../factories/issue.factory'
import { defaultRelationTypes } from '../factories/issueRelation.factory'
import { makeTaskType, systemTypes } from '../factories/issueType.factory'

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

interface Ref {
  projectKey: string
  number: number
}
/** 저장된 관계 한 건 — source 가 A 쪽. 방향 없는 유형은 어느 쪽이든 같다. */
interface StoredRelation {
  id: number
  typeId: number
  source: Ref
  target: Ref
}
interface StoredExternal extends IssueExternalLinkView {
  owner: Ref
}

/** 다음 POST 를 이 응답으로 실패시킨다 — 한 번 쓰이면 사라진다. */
export interface InjectedError {
  status: number
  code?: string
  message: string
}

export class IssueRelationServer {
  readonly types: IssueRelationType[]
  /** 이슈 제목 — `WP-1` 꼴 키 → 제목. 여기 없는 이슈는 상세가 404. */
  readonly titles = new Map<string, string>()
  relations: StoredRelation[] = []
  externals: StoredExternal[] = []
  history = new Map<string, IssueHistoryEntry[]>()
  /** 관계 대상 찾기가 돌려줄 목록. */
  lookupItems: IssueLookupItem[] = []
  /** 상세 응답의 편집 권한 — 비멤버 화면 검증용. */
  viewerCanEditWorkflow = true
  failNextRelationPost: InjectedError | null = null
  private nextId = 100
  private nextHistoryId = 1

  constructor(types: IssueRelationType[] = defaultRelationTypes()) {
    this.types = types
  }

  addIssue(key: string, title: string) {
    this.titles.set(key, title)
  }

  private keyOf(ref: Ref) {
    return `${ref.projectKey}-${ref.number}`
  }

  private pushHistory(owner: Ref, eventType: IssueHistoryEntry['eventType'], from: unknown, to: unknown) {
    const k = this.keyOf(owner)
    const list = this.history.get(k) ?? []
    list.push(
      createHistoryEntry({
        id: this.nextHistoryId++,
        eventType,
        fromValue: from == null ? null : JSON.stringify(from),
        toValue: to == null ? null : JSON.stringify(to),
      }),
    )
    this.history.set(k, list)
  }

  /** 이 이슈에서 본 관계 줄 — 방향 있는 유형은 A 쪽이면 outwardLabel, B 쪽이면 inwardLabel. */
  relationsOf(ref: Ref): IssueRelationView[] {
    const out: IssueRelationView[] = []
    for (const r of this.relations) {
      const type = this.types.find((t) => t.id === r.typeId)!
      const mineIsSource = r.source.projectKey === ref.projectKey && r.source.number === ref.number
      const mineIsTarget = r.target.projectKey === ref.projectKey && r.target.number === ref.number
      if (!mineIsSource && !mineIsTarget) continue
      const other = mineIsSource ? r.target : r.source
      out.push({
        id: r.id,
        typeId: r.typeId,
        typeCode: type.code,
        label: !type.directed || mineIsSource ? type.outwardLabel : (type.inwardLabel ?? type.outwardLabel),
        // 서버와 같은 규칙 — 방향 없는 유형은 늘 source.
        side: !type.directed || mineIsSource ? 'source' : 'target',
        issue: {
          projectKey: other.projectKey,
          number: other.number,
          title: this.titles.get(this.keyOf(other)) ?? `${this.keyOf(other)} 이슈`,
          status: 'TODO',
          type: makeTaskType(),
        },
      })
    }
    return out
  }

  externalsOf(ref: Ref): IssueExternalLinkView[] {
    return this.externals
      .filter((e) => e.owner.projectKey === ref.projectKey && e.owner.number === ref.number)
      .map(({ owner: _owner, ...view }) => view)
  }

  private detailOf(ref: Ref) {
    const key = this.keyOf(ref)
    return createIssueDetail({
      summary: {
        ...createIssue({ id: ref.number, number: ref.number, projectKey: ref.projectKey, title: this.titles.get(key) ?? key }),
        type: makeTaskType(),
        blockedBy: [],
        blocks: [],
        blocked: false,
      },
      body: '',
      history: this.history.get(key) ?? [],
      relations: this.relationsOf(ref),
      externalLinks: this.externalsOf(ref),
      viewerCanEditWorkflow: this.viewerCanEditWorkflow,
    })
  }

  /** 관계를 건다 — side 가 target 이면 상대가 A 쪽이 된다(방향 있는 유형만 의미 있음). */
  private addRelation(from: Ref, body: AddIssueRelationRequest) {
    const rel: StoredRelation =
      body.side === 'target'
        ? { id: this.nextId++, typeId: body.typeId, source: body.target, target: from }
        : { id: this.nextId++, typeId: body.typeId, source: from, target: body.target }
    this.relations.push(rel)
    const type = this.types.find((t) => t.id === body.typeId)!
    for (const owner of [from, body.target]) {
      const other = owner === from ? body.target : from
      const mine = this.relationsOf(owner).find((r) => r.id === rel.id)!
      this.pushHistory(owner, 'RELATION_ADDED', null, {
        typeId: type.id,
        label: mine.label,
        other: { projectKey: other.projectKey, number: other.number, title: this.titles.get(this.keyOf(other)) },
      })
    }
  }

  /** 모든 경로를 한 번에 건다 — 프로젝트·멤버·유형·라벨 같은 상세 진입 부가 조회도 포함. */
  async install(page: Page) {
    const path = (route: Route) => new URL(route.request().url()).pathname
    const issueRe = /^\/api\/v1\/projects\/([^/]+)\/issues\/(\d+)(\/.*)?$/

    await page.route('**/api/v1/projects/*', (route) => {
      const p = path(route)
      const m = /^\/api\/v1\/projects\/([^/]+)$/.exec(p)
      if (!m) return route.fallback()
      return route.fulfill(
        json({
          id: 1, key: m[1], name: m[1], description: '', ownerId: 1, ownerName: 'T',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }),
      )
    })
    await page.route(/\/api\/v1\/projects\/[^/]+\/members$/, (r) =>
      r.fulfill(json([{ userId: 1, username: 'me', name: 'Me', role: 'OWNER' }])),
    )
    await page.route(/\/api\/v1\/projects\/[^/]+\/types$/, (r) => r.fulfill(json(systemTypes())))
    await page.route(/\/api\/v1\/projects\/[^/]+\/labels$/, (r) => r.fulfill(json([])))
    await page.route(/\/api\/v1\/projects\/[^/]+\/issues\/\d+\/(watchers|attachments|drive-links)$/, (r) => r.fulfill(json([])))
    await page.route('**/api/v1/issues/*/comments', (r) => r.fulfill(json([])))
    await page.route((u) => u.pathname === '/api/v1/issue-relation-types', (r) => r.fulfill(json(this.types)))
    await page.route((u) => u.pathname === '/api/v1/issues/lookup', (r) => r.fulfill(json(this.lookupItems)))

    // 이슈 상세 + 관계·외부 링크 하위 경로.
    await page.route(
      (u) => /^\/api\/v1\/projects\/[^/]+\/issues\/\d+$/.test(u.pathname),
      (r) => {
        if (r.request().method() !== 'GET') return r.fallback()
        const m = issueRe.exec(path(r))!
        const ref = { projectKey: m[1], number: Number(m[2]) }
        if (!this.titles.has(this.keyOf(ref))) return r.fulfill(json({ message: 'not found' }, 404))
        return r.fulfill(json(this.detailOf(ref)))
      },
    )
    await page.route(
      (u) => /^\/api\/v1\/projects\/[^/]+\/issues\/\d+\/relations(\/\d+)?$/.test(u.pathname),
      (r) => {
        const m = issueRe.exec(path(r))!
        const from = { projectKey: m[1], number: Number(m[2]) }
        const req = r.request()
        if (req.method() === 'POST') {
          if (this.failNextRelationPost) {
            const e = this.failNextRelationPost
            this.failNextRelationPost = null
            return r.fulfill(json({ message: e.message, errors: e.code ? { code: e.code } : undefined }, e.status))
          }
          this.addRelation(from, req.postDataJSON() as AddIssueRelationRequest)
          return r.fulfill(json(this.relationsOf(from)))
        }
        if (req.method() === 'DELETE') {
          const id = Number(/\/relations\/(\d+)$/.exec(path(r))![1])
          const rel = this.relations.find((x) => x.id === id)
          if (rel) {
            const others = [rel.source, rel.target]
            for (const owner of others) {
              const mine = this.relationsOf(owner).find((x) => x.id === id)!
              const other = owner === rel.source ? rel.target : rel.source
              this.pushHistory(owner, 'RELATION_REMOVED', null, {
                typeId: rel.typeId,
                label: mine.label,
                other: { projectKey: other.projectKey, number: other.number, title: this.titles.get(this.keyOf(other)) },
              })
            }
            this.relations = this.relations.filter((x) => x.id !== id)
          }
          return r.fulfill({ status: 204, body: '' })
        }
        return r.fallback()
      },
    )
    await page.route(
      (u) => /^\/api\/v1\/projects\/[^/]+\/issues\/\d+\/external-links(\/\d+)?$/.test(u.pathname),
      (r) => {
        const m = issueRe.exec(path(r))!
        const owner = { projectKey: m[1], number: Number(m[2]) }
        const req = r.request()
        if (req.method() === 'POST') {
          const body = req.postDataJSON() as SaveIssueExternalLinkRequest
          const type = this.types.find((t) => t.id === body.typeId)!
          this.externals.push({
            owner, id: this.nextId++, typeId: type.id, typeCode: type.code,
            label: body.side === 'target' ? (type.inwardLabel ?? type.outwardLabel) : type.outwardLabel,
            side: type.directed && body.side === 'target' ? 'target' : 'source',
            url: body.url ?? '', key: body.key ?? null, title: body.title,
          })
          return r.fulfill(json(this.externalsOf(owner)))
        }
        const id = Number(/\/external-links\/(\d+)$/.exec(path(r))?.[1])
        if (req.method() === 'PUT') {
          const body = req.postDataJSON() as SaveIssueExternalLinkRequest
          const e = this.externals.find((x) => x.id === id)
          if (e) {
            const type = this.types.find((t) => t.id === body.typeId)!
            e.typeId = type.id
            e.typeCode = type.code
            e.label = body.side === 'target' ? (type.inwardLabel ?? type.outwardLabel) : body.side === 'source' ? type.outwardLabel : e.label
            if (body.side) e.side = type.directed && body.side === 'target' ? 'target' : 'source'
            e.key = body.key ?? null
            e.title = body.title
          }
          return r.fulfill(json(this.externalsOf(owner)))
        }
        if (req.method() === 'DELETE') {
          this.externals = this.externals.filter((x) => x.id !== id)
          return r.fulfill({ status: 204, body: '' })
        }
        return r.fallback()
      },
    )
  }
}

/** WP-7 에 같은 제목·키 길이만 다른 외부 링크 두 줄(19자·48자, WP-1108)을 건다 — 데스크톱·모바일 폭 검증이 같이 쓴다. */
export function seedLongKeyLinks(server: IssueRelationServer) {
  server.addIssue('WP-7', '외부 링크 이슈')
  const owner = { projectKey: 'WP', number: 7 }
  const base = { typeId: 2, typeCode: 'RELATES', label: '관련', side: 'source' as const, title: '로그인 실패 시 재시도 정책 정리' }
  server.externals.push(
    { ...base, owner, id: 1, url: 'https://jira.example.com/browse/PLATFORMINFRA-12345', key: 'PLATFORMINFRA-12345' },
    { ...base, owner, id: 2, url: 'https://jira.example.com/browse/LONG', key: `LONGKEY-${'1'.repeat(40)}` },
  )
}
