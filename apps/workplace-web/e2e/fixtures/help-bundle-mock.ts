// 도움말 묶음(`/help/…`, WP-1504 산출물) E2E 목(WP-1505).
// dev 서버는 요청마다 실제 매뉴얼에서 묶음을 만들지만, 배치 판정 테스트가 매뉴얼 내용·생성 시간에 기대지 않게 작은 묶음을 준다.
// 장 하나(「홈」, 주소 `/`)·절 둘이면 패널이 본문을 그리고, 다른 주소에서는 목차로 내려간다.
// 문맥 따라가기(WP-1506) E2E 용으로 「내 설정」 장(주소 `/settings/tokens`)에 API 토큰 화면의 네 절(tokens 층)을 더 둔다 —
// 절 본문은 서로 구분되는 글로, 「API 토큰 발급」 본문의 **토큰 발급** 은 단추 이름 강조(data-help-active) 판정용이다.
// 에이전트 상세의 「연결 방법」(WP-1507) E2E 용 「AI 에이전트 관리」 장(15장과 같은 주소 넷)·자리표시 목록은 화면 테스트 키트(helpBundleKit)의
// 것을 그대로 쓴다 — 외부 도구 연결 본문의 `{agent.username}` 명령 블록은 패널이 화면 값으로 채워 복사하는지(실제 클립보드) 본다.
import type { Page } from '@playwright/test'

import type { HelpChapter, HelpIndexChapter } from '../../src/components/help/helpBundle'
import { helpChapterFixtures, helpIndexFixture, helpVarsFixture } from '../../src/test/kits/help/helpBundleKit'

/** 키트의 AI 에이전트 관리 장 목차·장 파일 — 화면 테스트와 같은 절·본문. */
const AGENTS_INDEX = helpIndexFixture.find((c) => c.chapter === 'agents')!
const AGENTS: HelpChapter = helpChapterFixtures.agents

/** 목차 — 홈 장, 내 설정 장(API 토큰 화면의 tokens 층), AI 에이전트 관리 장(에이전트 상세 외부 연결). */
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
  {
    chapter: 'my-settings',
    number: 12,
    title: '내 설정',
    routes: ['/settings/tokens'],
    audience: ['member'],
    sections: [
      { id: 'my-settings#_intro', label: '내 설정', title: '내 설정', parent: null, level: 1 },
      { id: 'tokens', label: 'API 토큰', title: '외부 AI 도구를 연결한다', parent: null, level: 2 },
      { id: 'tokens.issue', label: 'API 토큰 발급', title: '토큰을 발급한다', parent: 'tokens', level: 3 },
      { id: 'tokens.list', label: 'API 토큰 목록', title: '발급한 토큰을 관리한다', parent: 'tokens', level: 3 },
      { id: 'tokens.connect', label: '도구에 연결하기', title: '도구에 연결한다', parent: 'tokens', level: 3 },
    ],
  },
  AGENTS_INDEX,
]

/** 장 파일 — 첫머리 본문이 패널 높이를 채우도록 문단을 여럿 두고, 끝에 긴 한 줄 코드 블록을 둔다(스크롤·넘침·복사 단추 겹침 판정용). */
const CHAPTER: HelpChapter = {
  ...INDEX[0],
  sections: [
    {
      ...INDEX[0].sections[0],
      // 맨 끝 코드 블록은 패널 폭보다 긴 한 줄 명령 — 복사 단추가 코드 글자를 덮지 않는지 본다(WP-1507).
      markdown: [
        ...Array.from({ length: 12 }, (_, i) => `홈 첫머리 문단 ${i + 1}. 오늘 할 일과 최근 활동을 한 화면에서 본다.`),
        '```\n/plugin marketplace add http://localhost:6173/claude/marketplace.json --scope project --and-a-very-long-tail\n```',
      ].join('\n\n'),
      figures: [],
      links: ['home.widgets'],
    },
    { ...INDEX[0].sections[1], markdown: '위젯 본문.', figures: [], links: [] },
  ],
}

/** 내 설정 장 — 절마다 본문 글을 달리 둬 어느 절이 보이는지 본문으로도 가린다. */
const MY_SETTINGS: HelpChapter = {
  ...INDEX[1],
  sections: [
    { ...INDEX[1].sections[0], markdown: '내 설정 첫머리 본문.', figures: [], links: [] },
    { ...INDEX[1].sections[1], markdown: 'API 토큰 절 본문.', figures: [], links: [] },
    { ...INDEX[1].sections[2], markdown: '발급 절 본문. 화면 위 **토큰 발급** 을 누른다.', figures: [], links: [] },
    { ...INDEX[1].sections[3], markdown: '목록 절 본문. 쓰지 않는 토큰은 **폐기** 한다.', figures: [], links: [] },
    { ...INDEX[1].sections[4], markdown: '연결 절 본문. 설치 명령을 **복사** 해 붙여 넣는다.', figures: [], links: [] },
  ],
}

/** `/help/` 아래 요청을 작은 묶음으로 답한다. 목록에 없는 장 파일은 404(패널이 목차로 내려간다). */
export async function mockHelpBundle(page: Page) {
  await page.route(
    (url) => url.pathname.startsWith('/help/'),
    (route) => {
      const { pathname } = new URL(route.request().url())
      if (pathname === '/help/manual-index.json') return route.fulfill({ json: INDEX })
      if (pathname === '/help/manual-vars.json') return route.fulfill({ json: helpVarsFixture })
      if (pathname === '/help/manual/home.json') return route.fulfill({ json: CHAPTER })
      if (pathname === '/help/manual/my-settings.json') return route.fulfill({ json: MY_SETTINGS })
      if (pathname === '/help/manual/agents.json') return route.fulfill({ json: AGENTS })
      return route.fulfill({ status: 404, body: '' })
    },
  )
}
