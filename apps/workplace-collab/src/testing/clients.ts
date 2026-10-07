import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'

import { FRAGMENT } from '../markdownCodec'

/** 테스트 클라이언트 — provider 와 관찰 가능한 이벤트 기록(종료 코드·인증 실패·stateless 메시지). */
export interface TestClient {
  doc: Y.Doc
  provider: HocuspocusProvider
  disconnects: Array<{ code: number; reason: string }>
  authFailures: string[]
  statelessMessages: string[]
}

/**
 * 실제 provider(Node 전역 WebSocket)로 동기화 서버의 /collab 에 붙는다 — server·internalRoutes·testMode 테스트 공용.
 * doc 을 넘기면 그 Y.Doc(캐시된 문서 흉내)으로 붙는다.
 */
export function connectClient(port: number, name: string, token: string, opts: { doc?: Y.Doc } = {}): TestClient {
  const doc = opts.doc ?? new Y.Doc()
  const c: TestClient = {
    doc,
    provider: undefined as unknown as HocuspocusProvider,
    disconnects: [],
    authFailures: [],
    statelessMessages: [],
  }
  c.provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}/collab`,
    name,
    token,
    document: doc,
    onDisconnect: ({ event }) => c.disconnects.push({ code: event.code, reason: event.reason }),
    onAuthenticationFailed: ({ reason }) => c.authFailures.push(reason),
    onStateless: ({ payload }) => c.statelessMessages.push(payload),
  })
  return c
}

/** 문단(index) 맨 앞에 글자 삽입 — 에디터 입력 흉내. */
export function typeAt(doc: Y.Doc, index: number, text: string): void {
  const block = doc.getXmlFragment(FRAGMENT).get(index) as Y.XmlElement
  ;(block.get(0) as Y.XmlText).insert(0, text)
}
