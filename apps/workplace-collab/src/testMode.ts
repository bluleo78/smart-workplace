import { pageIdOf } from './docRegistry'
import { pathOf, readJson, send, HttpError } from './internalRoutes'
import { markdownToYUpdate, yDocToMarkdown, yUpdateToMarkdown } from './markdownCodec'
import type { Authenticator, DocStore, TestRoutes } from './server'

/** 테스트 모드에서 내부 토큰을 따로 주지 않았을 때 쓰는 기본값 — E2E 가 apply-markdown(✦ 유발)을 부를 때 쓴다. */
export const TEST_MODE_INTERNAL_TOKEN = 'collab-test-internal'

/** 메모리 문서 한 건 — 시드 본문·역할과 저장된 상태. */
interface TestDoc {
  body: string
  /** 문서 기본 역할(토큰에 role 이 없을 때). 기본 OWNER. */
  role: string
  /** userId → 역할(같은 문서에 편집자·뷰어를 함께 두는 E2E 용). */
  roles: Record<string, string>
  state: Uint8Array | null
  version: number
}

/**
 * E2E 전용 — API 없이 동작한다(웹 E2E 는 API 를 page.route 로 모킹하므로 실제 API 가 없다).
 * 문서 내용·역할은 /__test/seed 로 테스트가 직접 심고, /__test/markdown 으로 저장(또는 열린) 결과를 읽는다.
 * 운영 빌드에서 켜지지 않도록 COLLAB_TEST_MODE=1 일 때만 app.ts 가 주입한다(createCollabServer 도 플래그를 다시 확인).
 *
 * 세션 도중 역할 변경은 /__test/role(문서를 닫지 않음) + /internal/docs/revalidate 로 재현한다.
 * 인증 토큰 = URLSearchParams 형식 `uid=2&name=김철수&role=VIEWER`(모두 선택) — 테스트가 사용자를 구분한다.
 * uid 기본 1, name 기본 `사용자 {uid}`, role 은 토큰 → 시드 roles[uid] → 시드 role → OWNER 순. role=NONE 이면 거부(권한 없음 시나리오).
 * 테넌트·스페이스는 항상 1.
 */
export function createTestMode(): { store: DocStore; auth: Authenticator; routes: TestRoutes } {
  const docs = new Map<string, TestDoc>()
  /** 메모리 문서 가져오기(없으면 기본값으로 만들어 둔다) — 시드 없이 저장된 문서의 기본값을 한곳에 둔다. */
  const docOf = (name: string): TestDoc => {
    let d = docs.get(name)
    if (!d) {
      d = { body: '', role: 'OWNER', roles: {}, state: null, version: 1 }
      docs.set(name, d)
    }
    return d
  }
  /** /__test/* 요청의 docName 검증 — 테스트 모드 이름 규약(`{ns}/wiki-page:{id}`)이 아니면 400. */
  const requireDocName = (b: { docName?: unknown }): string => {
    if (typeof b.docName !== 'string' || pageIdOf(b.docName, true) == null) throw new HttpError(400, 'invalid docName')
    return b.docName
  }

  const store: DocStore = {
    async load({ docName }) {
      const d = docs.get(docName)
      // 시드 없는 문서는 빈 노트로 연다.
      return { state: d?.state ?? null, body: d?.body ?? '', version: d?.version ?? 1, stale: false }
    },
    async store({ docName }, state, body) {
      const d = docOf(docName)
      d.state = state
      d.body = body
      d.version += 1
      return d.version
    },
    // 상태만 — 시드 본문·version 은 그대로(운영 API 와 같은 계약: 편집 없이 열기만 하면 version 이 오르지 않는다).
    async storeState({ docName }, state) {
      docOf(docName).state = state
    },
  }

  const auth: Authenticator = {
    async authenticate(docName, pageId, token) {
      const p = new URLSearchParams(token)
      const uid = Number(p.get('uid') ?? 1)
      if (!Number.isSafeInteger(uid) || uid <= 0) return null
      const d = docs.get(docName)
      const role = p.get('role') ?? d?.roles[String(uid)] ?? d?.role ?? 'OWNER'
      if (role === 'NONE') return null
      return { userId: uid, name: p.get('name') ?? `사용자 ${uid}`, tenantId: 1, spaceId: 1, role, expiresAt: null }
    },
  }

  /** 메모리 문서를 마크다운으로 — 상태가 있으면 상태에서, 없으면 시드 본문. */
  const savedMarkdown = (d: TestDoc): string => (d.state ? yUpdateToMarkdown(d.state) : d.body)

  const routes: TestRoutes = async (req, res, app) => {
    const path = pathOf(req)
    if (!path.startsWith('/__test/')) return false

    if (req.method === 'GET' && path === '/__test/health') return send(res, 200, { ok: true })

    // 시드 — 같은 이름이 열려 있으면 먼저 닫는다(이전 상태가 새 시드를 덮지 않게).
    if (req.method === 'POST' && path === '/__test/seed') {
      const b = (await readJson(req)) as { docName?: unknown; body?: unknown; role?: unknown; roles?: unknown }
      const docName = requireDocName(b)
      if (typeof b.body !== 'string') throw new HttpError(400, 'invalid body')
      await app.closeDocument(docName)
      // 상태를 시드 본문에서 미리 만들어 둔다 — 로드 시 이관 저장으로 version 이 한 번 오르는 것을 피하고, 매번 같은 시작 상태.
      docs.set(docName, {
        body: b.body,
        role: typeof b.role === 'string' ? b.role : 'OWNER',
        roles: b.roles && typeof b.roles === 'object' ? (b.roles as Record<string, string>) : {},
        state: markdownToYUpdate(b.body),
        version: 1,
      })
      return send(res, 204)
    }

    // 역할 변경 — 시드와 달리 열린 문서를 닫지 않는다. 이어서 /internal/docs/revalidate 를 부르면 서버가 접속 중인
    // 사용자를 다시 인증해 세션 도중 강등(collab:role)·접근 회수(4403)를 실제 경로 그대로 보낸다(E2E 시나리오).
    if (req.method === 'POST' && path === '/__test/role') {
      const b = (await readJson(req)) as { docName?: unknown; role?: unknown; roles?: unknown }
      const d = docs.get(requireDocName(b))
      if (!d) return send(res, 404, { error: 'unknown document' })
      if (typeof b.role === 'string') d.role = b.role
      if (b.roles && typeof b.roles === 'object') d.roles = b.roles as Record<string, string>
      return send(res, 204)
    }

    // 결과 읽기 — 열린 문서가 있으면 실시간 문서, 없으면 저장된 상태.
    if (req.method === 'GET' && path === '/__test/markdown') {
      const name = new URL(req.url ?? '/', 'http://collab').searchParams.get('docName') ?? ''
      const d = docs.get(name)
      const open = app.hocuspocus.documents.get(name)
      if (open) return send(res, 200, { markdown: yDocToMarkdown(open), version: d?.version ?? 1 })
      if (!d) return send(res, 404, { error: 'unknown document' })
      return send(res, 200, { markdown: savedMarkdown(d), version: d.version })
    }

    // 초기화 — ns 가 있으면 그 네임스페이스(`{ns}/…`) 문서만(병렬 E2E 워커가 서로의 문서를 지우지 않게), 없으면 전부.
    if (req.method === 'POST' && path === '/__test/reset') {
      const b = (await readJson(req)) as { ns?: unknown }
      const match = (name: string) => typeof b.ns !== 'string' || name.startsWith(`${b.ns}/`)
      const names = new Set([...docs.keys(), ...app.hocuspocus.documents.keys()].filter(match))
      for (const name of names) {
        await app.closeDocument(name)
        docs.delete(name)
      }
      return send(res, 204)
    }

    return send(res, 404, { error: 'not found' })
  }

  return { store, auth, routes }
}
