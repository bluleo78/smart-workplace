// 노트 HTML 스크립트 점검(WP-1290) 테스트 도구 — 서버 응답 목과 노트 지문 계산.
import { http, HttpResponse } from 'msw'

import { joinHtmlScriptSources, sha256Hex, type WikiHtmlScriptsCheck } from '@/components/wiki/wikiHtmlBlockSecurity'
import type { SecurityCheckView } from '@/types/securityCheck'

/** 노트 지문 — 스크립트가 든 소스들을 화면과 같은 규칙으로 이어 붙여 SHA-256 16진으로. */
export async function htmlScriptsHash(sources: string[]): Promise<string> {
  const hex = sha256Hex(joinHtmlScriptSources(sources))
  if (!hex) throw new Error('crypto.subtle 이 없다')
  return hex
}

/** 끝난 점검 결과 — 위험도·이유만 바꿔 쓴다. */
export function doneView(risk: 'LOW' | 'CAUTION' | 'HIGH', headline: string | null = null): SecurityCheckView {
  return {
    status: 'DONE',
    risk,
    headline,
    evidence: risk === 'LOW' ? [] : [{ kind: 'CREDENTIAL_INPUT', detail: '입력값을 외부 주소로 보낸다' }],
    checkedAt: '2026-11-02T12:00:00Z',
    reason: null,
  }
}

/**
 * 점검 조회 목 — 앱 안(`/wiki/pages/:id/...`)과 공개 공유(`/public/wiki/shares/:token/pages/:id/...`) 둘 다 받는다.
 * 기본은 점검 행이 없는 노트(지문만 있고 결과 없음). 받은 요청은 calls 에 쌓인다.
 */
export function htmlScriptsCheckHandlers(check: Partial<WikiHtmlScriptsCheck> = {}) {
  const calls: Array<{ method: string; path: string }> = []
  const body: WikiHtmlScriptsCheck = { hash: null, blockCount: 0, view: null, ...check }
  const reply = ({ request }: { request: Request }) => {
    calls.push({ method: request.method, path: new URL(request.url).pathname })
    return HttpResponse.json(body)
  }
  return {
    calls,
    handlers: [
      http.get('/api/v1/wiki/pages/:id/html-scripts/security-check', reply),
      http.post('/api/v1/wiki/pages/:id/html-scripts/security-check', reply),
      http.get('/api/v1/public/wiki/shares/:token/pages/:id/html-scripts/security-check', reply),
    ],
  }
}
