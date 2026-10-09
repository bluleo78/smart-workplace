// 노트 접속자·원격 커서 E2E(WP-173) 공용 상수·헬퍼 — pages/wiki·pages/mobile 의 wiki-presence*.spec.ts 가 함께 쓴다.
import type { Locator, Page } from '@playwright/test'

/** 두 번째 컨텍스트로 로그인할 다른 사람(newAuthedPage({ user: KIM })) — 동기화 토큰 uid=2. */
export const KIM = { id: 2, name: '김철수' }

/** 그 사람의 원격 커서 위젯(WikiPresenceCursors). */
export function cursorOf(page: Page, userId: number): Locator {
  return page.locator(`.wiki-presence-cursor[data-user-id="${userId}"]`)
}

/** 스크롤해야 닿는 긴 노트(첫 문단 + 문단 1..40) — 목록·시트에서 커서로 이동을 확인한다. */
export const LONG_BODY = ['첫 문단', ...Array.from({ length: 40 }, (_, i) => `문단 ${i + 1}`)].join('\n\n')

/** 실제 같은 회의록 본문(제목·번호 목록·긴 문단) — 블록 3 이 마지막 일반 문단(0 제목·1 번호 목록·2 제목). */
export const LAYOUT_BODY = [
  '## 결정 사항',
  '1. 노트 동시 편집은 Yjs + Hocuspocus 로 간다. 배포는 API → collab → 웹 순서로 하고 롤백 시 body_version 비교로 밖에서 바뀐 본문을 반영한다.',
  '2. 모바일 이슈 상세는 다음 사이클로 이월하고 담당자를 다시 정한다. 이월 사유와 남은 작업 목록은 이 문단 아래에 정리한다.',
  '## 회고 요약',
  '이번 사이클은 계획 대비 82% 를 완료했으며, 주요 지연 원인은 E2E 불안정과 리뷰 대기였다. 다음 사이클에서는 리뷰 SLA 를 하루로 정하고 대기 중인 PR 을 매일 아침 점검한다.',
].join('\n\n')

/** 다수 접속자 — 긴 한글·영문 이름 섞음(7명 + 브라우저 B = 8명). */
export const LAYOUT_PEERS = [
  { id: 3, name: '박민수 (플랫폼개발팀 · 백엔드 파트 리드)' },
  { id: 4, name: 'Alexandria Montgomery-Fitzgerald' },
  { id: 5, name: '이영희 (디자인시스템 TF · 시니어 프로덕트 디자이너)' },
  { id: 6, name: '최수진' },
  { id: 7, name: '정우성 (데이터플랫폼)' },
  { id: 8, name: '한지민 (QA)' },
  { id: 10, name: 'Christopher Bartholomew Jr.' },
]

/** 보이는 이름표(✦ 태그 + 켜진 커서 이름표)가 서로 겹치지 않는지(1px 허용). */
export function tagsDisjoint(page: Page): Promise<{ count: number; disjoint: boolean }> {
  return page.evaluate(() => {
    const tags = [
      ...document.querySelectorAll('.wiki-ai-marker__tag, .wiki-presence-cursor[data-label-visible] .wiki-presence-cursor__tag'),
    ]
    const rects = tags.map((t) => t.getBoundingClientRect())
    const hit = (p: DOMRect, q: DOMRect) =>
      p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1
    return { count: tags.length, disjoint: rects.every((r, i) => rects.every((q, j) => j <= i || !hit(r, q))) }
  })
}
