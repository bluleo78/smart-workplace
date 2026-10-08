// 노트 동시 편집 동기화 서버(workplace-collab, 테스트 모드) 조작 — 문서 시드·결과 읽기·역할 변경.
// 서버는 playwright.config.ts 의 webServer 가 E2E_COLLAB_PORT 로 띄운다. 문서 이름에 테스트별 네임스페이스(collabNs)를
// 붙여 병렬 worker 가 한 서버를 같이 써도 서로의 문서가 섞이지 않게 한다(문서 이름 규약은 웹과 같은 collab-protocol).
import type { BrowserContext, Page, WebSocketRoute } from '@playwright/test'
import {
  COLLAB_NS_STORAGE_KEY,
  collabDocName,
  REVALIDATE_REASON_DELETED,
  WIKI_SCHEMA_VERSION,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'

import type { WikiRole } from '../../src/types/wiki'

/** playwright.config.ts 가 동기화 서버에 주입하고 env 로 worker 에 물려주는 테스트 모드 내부 토큰. */
const internalToken = () => process.env.E2E_COLLAB_INTERNAL_TOKEN

/** 웹이 붙는 문서를 시드·조회할 때 쓰는 역할 — 'NONE' 은 접근 없음(테스트 모드 인증 스텁이 forbidden 으로 거부). */
export type CollabRole = WikiRole | 'NONE'

const base = () => `http://localhost:${process.env.E2E_COLLAB_PORT}`

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`collab ${path} failed ${res.status}: ${await res.text()}`)
  return res
}

/**
 * 문서를 마크다운 본문으로 시드한다. 같은 이름이 열려 있으면 서버가 먼저 닫는다(접속자는 끊긴다) —
 * 그래서 페이지를 열기 전(goto 전)에 한 번만 부른다. 페이지 상세 GET 라우트 안에서 부르면 재조회마다 편집이 날아간다.
 */
export async function seedCollabDoc(ns: string, pageId: number, body: string, role: CollabRole = 'OWNER'): Promise<void> {
  await post('/__test/seed', { docName: collabDocName(ns, pageId), body, role })
}

/** 서버 문서의 현재 마크다운 — 열려 있으면 실시간 문서, 아니면 저장된 상태. */
export async function readCollabMarkdown(ns: string, pageId: number): Promise<string> {
  const res = await fetch(`${base()}/__test/markdown?docName=${encodeURIComponent(collabDocName(ns, pageId))}`)
  if (!res.ok) throw new Error(`collab markdown failed ${res.status}`)
  return ((await res.json()) as { markdown: string }).markdown
}

/**
 * 세션 도중 역할을 바꾼다 — 문서를 닫지 않고 역할만 바꾼 뒤 내부 revalidate 를 불러, 서버가 접속자를 다시 인증하게 한다.
 * 편집→VIEWER 는 collab:role 알림(에디터 잠금), NONE 은 4403 종료(삭제·권한 없음 안내)가 실제 경로 그대로 간다.
 * reason 에 REVALIDATE_REASON_DELETED 를 주면 API 가 노트 삭제 뒤 부르는 재검증과 같다(WP-296) — role 'NONE' 과 함께 쓰면
 * 접근을 잃은 접속자가 4404(삭제)로 닫힌다. 같은 페이지 번호의 다른 네임스페이스 문서는 재판정이 접근 가능이라 끊기지 않는다.
 */
export async function changeCollabRole(
  ns: string,
  pageId: number,
  role: CollabRole,
  reason?: typeof REVALIDATE_REASON_DELETED,
): Promise<void> {
  await post('/__test/role', { docName: collabDocName(ns, pageId), role })
  // reason 이 없으면 JSON.stringify 가 키를 생략한다(사유 없는 재검증).
  await post('/internal/docs/revalidate', { tenantId: 1, pageIds: [pageId], reason }, { Authorization: `Internal ${internalToken()}` })
}

/**
 * 동기화 서버가 이 문서에 기대하는 스키마 판을 바꾼다(WP-313) — '동기화 서버만 새 스키마로 배포됨'(웹 탭은 옛 판)을 재현한다.
 * 열린 연결은 그대로고 다음 인증부터 적용된다(세션 도중 배포는 controlCollabSocket 으로 끊었다 붙여 재현). 판을 생략하면 웹과 같은 판으로 되돌린다.
 */
export async function setCollabSchemaVersion(ns: string, pageId: number, version = WIKI_SCHEMA_VERSION): Promise<void> {
  await post('/__test/schema-version', { docName: collabDocName(ns, pageId), version })
}

/**
 * 본문 적용을 테스트 모드 동기화 서버에 직접 부른다 — MCP·채팅 비서(ai)나 구버전 웹(ai:false)의 본문 PUT 이 API 를 거쳐 도착한 것과 같다
 * (웹 E2E 는 API 가 모킹이라 내부 경로를 직접 친다). baseBody 가 있으면 3-way 병합, 없으면 replace.
 */
export async function applyCollabMarkdown(
  ns: string,
  pageId: number,
  opts: { body: string; baseBody?: string; ai?: boolean; actor?: { userId: number; name: string } },
): Promise<{ version: number; body: string }> {
  const res = await post(
    `/internal/docs/${pageId}/apply-markdown`,
    {
      tenantId: 1,
      docName: collabDocName(ns, pageId),
      mode: opts.baseBody == null ? 'replace' : 'merge',
      ...(opts.baseBody == null ? {} : { baseBody: opts.baseBody }),
      body: opts.body,
      actor: opts.actor ?? { userId: 9, name: '김에이아이' },
      ai: opts.ai ?? true,
    },
    { Authorization: `Internal ${internalToken()}` },
  )
  return (await res.json()) as { version: number; body: string }
}

// 컨텍스트 → 네임스페이스. auth.fixture 가 테스트 컨텍스트(와 newAuthedPage 컨텍스트)에 등록한다 —
// 헬퍼(mockWikiPageEditor·spec 별 모킹)가 collabNs 를 일일이 넘겨받지 않고 page 만으로 시드할 수 있게.
const nsByContext = new WeakMap<BrowserContext, string>()

/** 컨텍스트의 모든 페이지가 같은 네임스페이스 문서에 붙도록 localStorage 에 심는다(웹 collabSession 이 문서 이름에 붙인다). */
export async function injectCollabNamespace(context: BrowserContext, ns: string): Promise<void> {
  nsByContext.set(context, ns)
  await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [COLLAB_NS_STORAGE_KEY, ns] as const)
}

/** 이 page 가 쓰는 네임스페이스. auth.fixture 를 거치지 않은 컨텍스트면 빈 문자열(네임스페이스 없음). */
export function collabNsOf(page: Page): string {
  return nsByContext.get(page.context()) ?? ''
}

/** page 의 네임스페이스로 문서를 시드한다 — spec 별 노트 모킹이 페이지 상세 본문과 같은 내용을 서버에 심을 때 쓴다. */
export function seedCollabFor(page: Page, pageId: number, body: string, role: CollabRole = 'OWNER'): Promise<void> {
  return seedCollabDoc(collabNsOf(page), pageId, body, role)
}

/**
 * 동기화 웹소켓을 테스트가 끊었다 붙였다 한다(goto 전에 호출). Chromium 의 context.setOffline 은 이미 열린 웹소켓을
 * 끊지 않으므로 오프라인은 이렇게 흉내 낸다 — drop() 은 열린 소켓을 닫고 재접속도 바로 닫아 거부하며,
 * restore() 뒤 provider 의 다음 재접속부터 다시 서버로 잇는다.
 * hold()/release() 는 연결은 둔 채 브라우저 → 서버 방향 메시지만 붙잡았다 순서대로 보낸다 — "내가 친 글자가 아직 서버로 가는 중"
 * (서버 → 브라우저는 그대로 흐른다)을 결정적으로 만들 때 쓴다.
 */
export async function controlCollabSocket(
  page: Page,
): Promise<{ drop: () => Promise<void>; restore: () => void; hold: () => void; release: () => void }> {
  let blocked = false
  let holding = false
  const held: Array<() => void> = []
  const open = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>()
  await page.routeWebSocket(/\/collab/, (ws) => {
    if (blocked) {
      void ws.close()
      return
    }
    const server = ws.connectToServer()
    // 브라우저 → 서버를 직접 넘긴다(onMessage 를 걸면 자동 전달이 꺼진다) — 붙잡는 동안은 쌓아 둔다.
    ws.onMessage((m) => {
      const send = () => server.send(m)
      if (holding) held.push(send)
      else send()
    })
    const pair = { page: ws, server }
    open.add(pair)
    ws.onClose(() => open.delete(pair))
  })
  return {
    hold: () => {
      holding = true
    },
    release: () => {
      holding = false
      for (const send of held.splice(0)) send()
    },
    drop: async () => {
      blocked = true
      for (const { page: p, server } of [...open]) {
        await server.close()
        await p.close()
      }
      open.clear()
    },
    restore: () => {
      blocked = false
    },
  }
}

/**
 * 노트 본문에서 paragraph 를 담은 문단 끝에 이어 친다 — 문단 마지막 글자의 오른쪽 가장자리를 눌러 캐럿을 둔다.
 * 예전엔 문단을 누르고 End 를 눌렀는데, macOS Chromium 은 End 로 캐럿을 줄 끝에 보내지 않아(문서 스크롤만) 문단 가운데를
 * 누른 자리에 그대로 쳤다 — 가운데가 글자 오른쪽 빈칸인 짧은 문단에서만 우연히 끝에 들어갔다. 마지막 글자 사각형의
 * 오른쪽 끝을 누르면 줄바꿈된 긴 문단도 플랫폼과 무관하게 끝에 놓인다.
 */
export async function typeAtEnd(page: Page, paragraph: string, text: string): Promise<void> {
  const para = page.locator('.ProseMirror p', { hasText: paragraph }).first()
  await para.scrollIntoViewIfNeeded()
  const point = await para.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (node.length > 0) last = node
    }
    if (!last) throw new Error('문단에 글자가 없다')
    const range = document.createRange()
    range.setStart(last, last.length - 1)
    range.setEnd(last, last.length)
    // 마지막 글자가 줄바꿈 경계에 걸치면 사각형이 여럿 — 마지막(아래 줄) 것을 쓴다.
    const rects = range.getClientRects()
    const r = rects[rects.length - 1]
    return { x: r.right - 1, y: r.top + r.height / 2 }
  })
  await page.mouse.click(point.x, point.y)
  await page.keyboard.type(text)
}
