// 도움말 묶음(`/help/…`, WP-1504 산출물) E2E 목(WP-1505).
// dev 서버는 요청마다 실제 매뉴얼에서 묶음을 만들지만, 배치 판정 테스트가 매뉴얼 내용·생성 시간에 기대지 않게 작은 묶음을 준다.
// 장 하나(「홈」, 주소 `/`)·절 둘이면 패널이 본문을 그리고, 다른 주소에서는 목차로 내려간다.
import type { Page } from '@playwright/test'

import type { HelpChapter, HelpIndexChapter, HelpVars } from '../../src/components/help/helpBundle'

/** 목차 — 홈 장 하나. */
const INDEX: HelpIndexChapter[] = [
  {
    chapter: 'home',
    number: 3,
    title: '홈',
    routes: ['/'],
    audience: ['member'],
    sections: [
      { id: 'home', label: '홈', title: '홈', parent: null, level: 1 },
      { id: 'home.widgets', label: '위젯', title: '위젯을 고른다', parent: 'home', level: 2 },
    ],
  },
]

/** 장 파일 — 첫머리 본문이 패널 높이를 채우도록 문단을 여럿 둔다(스크롤·넘침 판정용). */
const CHAPTER: HelpChapter = {
  ...INDEX[0],
  sections: [
    {
      ...INDEX[0].sections[0],
      markdown: Array.from({ length: 12 }, (_, i) => `홈 첫머리 문단 ${i + 1}. 오늘 할 일과 최근 활동을 한 화면에서 본다.`).join('\n\n'),
      figures: [],
      links: ['home.widgets'],
    },
    { ...INDEX[0].sections[1], markdown: '위젯 본문.', figures: [], links: [] },
  ],
}

const VARS: HelpVars = { placeholders: [], conditions: [] }

/** `/help/` 아래 요청을 작은 묶음으로 답한다. 목록에 없는 장 파일은 404(패널이 목차로 내려간다). */
export async function mockHelpBundle(page: Page) {
  await page.route(
    (url) => url.pathname.startsWith('/help/'),
    (route) => {
      const { pathname } = new URL(route.request().url())
      if (pathname === '/help/manual-index.json') return route.fulfill({ json: INDEX })
      if (pathname === '/help/manual-vars.json') return route.fulfill({ json: VARS })
      if (pathname === '/help/manual/home.json') return route.fulfill({ json: CHAPTER })
      return route.fulfill({ status: 404, body: '' })
    },
  )
}
