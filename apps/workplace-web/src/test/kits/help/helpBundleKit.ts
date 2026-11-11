// 도움말 묶음 테스트 키트(WP-1505) — 패널·모바일 시트 화면 테스트가 같은 작은 묶음(`/help/…`)을 MSW 로 받게 한다.
// 장 둘: 누구나 보는 「홈」(주소 `/`)과 관리자만 보는 「AI 에이전트 관리」(주소 `/settings/agents/:id`).
// 홈 첫머리는 관리자 장 절과 같은 장 절을 함께 링크해, 일반 구성원의 「관련」에서 관리자 장만 빠지는지 볼 수 있다.
import { http, HttpResponse, type RequestHandler } from 'msw'

import type { HelpChapter, HelpIndexChapter, HelpVars } from '@/components/help/helpBundle'

/** 목차(manual-index.json). */
export const helpIndexFixture: HelpIndexChapter[] = [
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
    chapter: 'agents',
    number: 9,
    title: 'AI 에이전트 관리',
    routes: ['/settings/agents/:id'],
    audience: ['admin'],
    sections: [
      { id: 'agents#_intro', label: 'AI 에이전트 관리', title: 'AI 에이전트 관리', parent: null, level: 1 },
      { id: 'agent.run', label: '실행', title: '실행을 설정한다', parent: null, level: 2 },
      { id: 'agent.run.repo', label: '저장소 연결', title: '저장소를 연결한다', parent: 'agent.run', level: 3 },
    ],
  },
]

/** 장 파일(manual/<chapter>.json). */
export const helpChapterFixtures: Record<string, HelpChapter> = {
  home: {
    ...helpIndexFixture[0],
    sections: [
      {
        ...helpIndexFixture[0].sections[0],
        markdown: '홈 첫머리 본문. [에이전트](help:agents#_intro) 와 [위젯](help:home.widgets) 을 본다.',
        figures: [],
        links: ['agents#_intro', 'home.widgets'],
      },
      { ...helpIndexFixture[0].sections[1], markdown: '위젯 본문.', figures: [], links: [] },
    ],
  },
  agents: {
    ...helpIndexFixture[1],
    sections: [
      { ...helpIndexFixture[1].sections[0], markdown: '에이전트 첫머리 본문.', figures: [], links: [] },
      { ...helpIndexFixture[1].sections[1], markdown: '실행 본문. 아이디는 {agent.username} 이다.', figures: [], links: [] },
      { ...helpIndexFixture[1].sections[2], markdown: '저장소 연결 본문.', figures: [], links: [] },
    ],
  },
}

/** manual-vars.json. */
export const helpVarsFixture: HelpVars = {
  placeholders: [{ name: 'agent.username', display: '<AI 아이디>', description: 'AI 에이전트 아이디' }],
  conditions: [],
}

/** 묶음 세 가지를 모두 정상으로 주는 핸들러. 앞에 놓인 핸들러가 이기므로 테스트는 바꿀 것만 앞에 더한다. */
export function helpBundleHandlers(): RequestHandler[] {
  return [
    http.get('/help/manual-index.json', () => HttpResponse.json(helpIndexFixture)),
    http.get('/help/manual-vars.json', () => HttpResponse.json(helpVarsFixture)),
    http.get('/help/manual/:file', ({ params }) => {
      const chapter = helpChapterFixtures[String(params.file).replace(/\.json$/, '')]
      return chapter ? HttpResponse.json(chapter) : new HttpResponse(null, { status: 404 })
    }),
  ]
}
