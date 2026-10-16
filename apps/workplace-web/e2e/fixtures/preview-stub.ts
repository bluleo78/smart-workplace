// 변환 미리보기(/preview) 응답 순서 모킹(WP-431·WP-432) — 드라이브(drive-mock)·메일(mail-viewer-mock) fixture 가 같은 계약을 쓴다.
// 서버 계약: 200 = 변환 PDF, 202 = 변환 중, 422 = 실패(code·transient), 404 = 대상 아님(NOT_APPLICABLE) 또는 존재 은닉(예외 봉투).
import type { Page } from '@playwright/test'

import { SAMPLE_PDF } from './samples'

/**
 * 변환 미리보기 응답 하나 — 200 = 변환 PDF(SAMPLE_PDF), 202 = 변환 중, 422 = 실패(code·transient),
 * 404 = notApplicable 이면 서버의 "대상 아님" 본문(`{"status":"NOT_APPLICABLE"}`), 아니면 예외 봉투(휴지통·권한·원본 유실과 같은 모양).
 */
export type PreviewStub =
  | { status: 200 }
  | { status: 202 }
  | { status: 422; code: string; transient: boolean }
  | { status: 404; notApplicable: boolean }

/** 응답 하나를 route.fulfill 인자로 바꾼다. */
function toResponse(stub: PreviewStub) {
  switch (stub.status) {
    case 200:
      return { status: 200, contentType: 'application/pdf', body: SAMPLE_PDF }
    case 202:
      return { status: 202, json: { status: 'CONVERTING' } }
    case 404:
      return {
        status: 404,
        json: stub.notApplicable
          ? { status: 'NOT_APPLICABLE' }
          : { status: 404, error: 'Not Found', message: '파일을 찾을 수 없습니다' },
      }
    case 422:
      return { status: 422, json: { status: 'FAILED', code: stub.code, transient: stub.transient } }
  }
}

/**
 * pathname 의 /preview 를 요청마다 seq 순서대로 응답하고, 끝나면 마지막 값을 반복한다.
 * pathname 일치라 ?start=true 가 붙어도 같은 순서를 탄다.
 */
export async function routePreviewSequence(page: Page, pathname: string, seq: PreviewStub[]): Promise<void> {
  let next = 0
  await page.route((u) => u.pathname === pathname, async (r) => {
    const stub = seq[Math.min(next, seq.length - 1)]
    // 응답이 실제로 나간 요청만 순서를 넘긴다 — 개발 모드 StrictMode 이중 마운트로 곧바로 abort 된 첫 요청이 순서를 먹지 않게.
    try {
      await r.fulfill(toResponse(stub))
      next++
    } catch {
      // abort 된 요청 — 무시한다.
    }
  })
}
