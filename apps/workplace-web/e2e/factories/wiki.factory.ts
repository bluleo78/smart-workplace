// 위키 E2E 팩토리 — 스페이스·페이지 응답 모킹용.
import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../src/types/wiki'

export function wikiSpace(over: Partial<WikiSpace> = {}): WikiSpace {
  return {
    id: 1,
    type: 'TEAM',
    name: '팀 위키',
    ownerId: 1,
    role: 'VIEWER',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

export function wikiPageSummary(over: Partial<WikiPageSummary> = {}): WikiPageSummary {
  return {
    id: 101,
    parentId: null,
    title: '온보딩 가이드',
    position: 0,
    // #736: 기본값은 AI 이력 없음 — 배지 노출 케이스는 over 로 명시 지정.
    aiLastUsedAt: null,
    ...over,
  }
}

export function wikiPageDetail(over: Partial<WikiPageDetail> = {}): WikiPageDetail {
  return {
    id: 101,
    spaceId: 1,
    parentId: null,
    title: '온보딩 가이드',
    body: '# 온보딩\n신규 입사자를 위한 안내 문서입니다.',
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
    ...over,
  }
}

/** 「HTML 문서」 페이지 상세(WP-1307) — 원본 HTML 을 그대로 보관한다. body 는 서버가 원본에서 뽑은 글자. */
export function wikiHtmlPageDetail(over: Partial<WikiPageDetail> = {}): WikiPageDetail {
  return wikiPageDetail({
    title: '분기 대시보드',
    body: '분기 대시보드',
    kind: 'HTML',
    html: '<!doctype html><html><head><title>분기 대시보드</title></head><body><h1>매출 차트</h1><script>document.body.dataset.ran = "1"</script></body></html>',
    ...over,
  })
}
