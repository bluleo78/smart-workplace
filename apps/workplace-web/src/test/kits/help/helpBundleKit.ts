// 도움말 묶음 테스트 키트(WP-1505) — 패널·모바일 시트 화면 테스트가 같은 작은 묶음(`/help/…`)을 MSW 로 받게 한다.
// 장 둘: 누구나 보는 「홈」(주소 `/`)과 관리자만 보는 「AI 에이전트 관리」(주소 `/settings/agents/:id`).
// 「AI 에이전트 관리」에는 설정 화면 AI 참고 요약(WP-1507)이 읽는 대표 절(agents·agents.list·agents.locations·agents.accounts·agent)과
// 에이전트 상세 외부 연결 절(agent.run.keys·agent.run.keys.connect — 목록 안 코드 블록·조건 블록·자리표시)도 든다. 주소는 15장과 같은 넷이다.
// 홈 첫머리는 관리자 장 절과 같은 장 절을 함께 링크해, 일반 구성원의 「관련」에서 관리자 장만 빠지는지 볼 수 있다.
// 「내 설정」(주소 `/settings/tokens`)은 도움말 문맥 고르기(WP-1506) — 화면 칸 data-help 와 짝인 도움말 id 절 넷(tokens 층)을 든다.
// 「AI 에이전트 관리」 장·자리표시 목록은 E2E 도움말 목(e2e/fixtures/help-bundle-mock.ts)도 그대로 쓴다 — 바꾸면 E2E 「연결 방법」 판정도 함께 본다.
import { http, HttpResponse, type RequestHandler } from 'msw'

import type { HelpSearchHit } from '@/api/help'
import type { HelpChapter, HelpIndexChapter, HelpVars } from '@/components/help/helpBundle'

/**
 * 외부 도구 연결 절 본문(15장 agent.run.keys.connect 의 축소판) — 번호 목록 안에 들여 쓴 코드 블록, 기본 주소가 아닌 서버만 보이는
 * 조건 블록(서버 주소 코드 블록 포함), AI 아이디 자리표시가 든 명령을 둔다. 패널이 목록을 끊지 않고 값을 채워 복사하는지 본다.
 */
const AGENT_CONNECT_MARKDOWN = [
  '외부 연결 본문.',
  '',
  '1. 플러그인을 설치합니다.',
  '',
  '   ```',
  '   /plugin install genia-works@genia-works',
  '   ```',
  '',
  '2. 서버 주소를 확인합니다.',
  '   {if app.customMcpServer}',
  '   서버 주소를 바꿉니다.',
  '',
  '   ```',
  '   /plugin configure genia-works@genia-works',
  '   ```',
  '',
  '   ```',
  '   {app.mcpEndpoint}',
  '   ```',
  '   {/if}',
  '3. 이 AI 로 바꿉니다.',
  '',
  '   ```',
  '   /genia-works:as {agent.username}',
  '   ```',
  '',
  '   ```',
  '   GENIA_WORKS_AS={agent.username} claude',
  '   ```',
].join('\n')

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
    routes: ['/settings/agents', '/settings/agents/locations', '/settings/agents/accounts', '/settings/agents/:id'],
    audience: ['admin'],
    sections: [
      { id: 'agents#_intro', label: 'AI 에이전트 관리', title: 'AI 에이전트 관리', parent: null, level: 1 },
      { id: 'agent.run', label: '실행', title: '실행을 설정한다', parent: null, level: 2 },
      { id: 'agent.run.repo', label: '저장소 연결', title: '저장소를 연결한다', parent: 'agent.run', level: 3 },
      // WP-1507: 설정 화면 AI 참고(useManualSummary)의 대표 절 — 앞 절들의 순서·층은 패널 테스트가 보므로 뒤에 붙인다.
      // agents.list 는 15장처럼 agents 절 아래다(agents 절은 뒤에 붙였다 — 앞 절들의 차례를 바꾸지 않으려고).
      { id: 'agents.list', label: '목록', title: '에이전트 목록을 본다', parent: 'agents', level: 3 },
      { id: 'agents.list.personal', label: '개인 비서 표시', title: '개인 비서를 함께 본다', parent: 'agents.list', level: 4 },
      { id: 'agent', label: '에이전트 상세', title: '에이전트 상세를 연다', parent: null, level: 2 },
      // WP-1507 에이전트 화면 탭 셋의 대표 절과 에이전트 상세 접속 키·외부 도구 연결 절.
      { id: 'agents', label: '에이전트', title: '에이전트 화면을 연다', parent: null, level: 2 },
      { id: 'agents.locations', label: '실행 환경', title: '실행 환경을 관리한다', parent: 'agents', level: 3 },
      { id: 'agents.accounts', label: '계정', title: 'AI 계정을 모아 둔다', parent: 'agents', level: 3 },
      { id: 'agent.run.keys', label: '접속 키', title: '접속 키를 관리한다', parent: 'agent.run', level: 3 },
      { id: 'agent.run.keys.connect', label: '외부 도구 연결', title: '외부 도구에 연결한다', parent: 'agent.run.keys', level: 4 },
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
      { ...helpIndexFixture[1].sections[3], markdown: '에이전트 표 안내. **새 에이전트** 로 만든다.\n\n```\n/cmd\n```', figures: [], links: [] },
      { ...helpIndexFixture[1].sections[4], markdown: '개인 비서 표시 본문.\n\n둘째 문단.', figures: [], links: [] },
      { ...helpIndexFixture[1].sections[5], markdown: '에이전트 상세 본문. 아이디는 {agent.username} 이다.', figures: [], links: [] },
      { ...helpIndexFixture[1].sections[6], markdown: '에이전트 화면 본문.', figures: [], links: [] },
      { ...helpIndexFixture[1].sections[7], markdown: '실행 환경 본문. 연결 프로그램을 설치한다.', figures: [], links: [] },
      { ...helpIndexFixture[1].sections[8], markdown: '계정 본문. 사용률을 본다.', figures: [], links: [] },
      { ...helpIndexFixture[1].sections[9], markdown: '접속 키 본문.', figures: [], links: ['agent.run.keys.connect'] },
      { ...helpIndexFixture[1].sections[10], markdown: AGENT_CONNECT_MARKDOWN, figures: [], links: [] },
    ],
  },
  'my-settings': {
    ...helpIndexFixture[2],
    sections: [
      { ...helpIndexFixture[2].sections[0], markdown: '내 설정 첫머리 본문.', figures: [], links: [] },
      { ...helpIndexFixture[2].sections[1], markdown: 'API 토큰 본문.', figures: [], links: [] },
      { ...helpIndexFixture[2].sections[2], markdown: '발급 본문. **토큰 발급** 을 누른다.', figures: [], links: [] },
      { ...helpIndexFixture[2].sections[3], markdown: '목록 본문. **폐기** 를 누른다.', figures: [], links: [] },
      { ...helpIndexFixture[2].sections[4], markdown: '연결 본문. **복사** 를 누른다.', figures: [], links: [] },
    ],
  },
}

/** manual-vars.json. */
export const helpVarsFixture: HelpVars = {
  // display 는 실제 manual-vars.json(help-vars.mjs)처럼 괄호 없는 이름이다 — 「<…>」는 채우는 쪽(fillHelpSnippet)이 붙인다.
  placeholders: [
    { name: 'agent.username', display: 'AI 아이디', description: 'AI 에이전트 아이디' },
    { name: 'app.mcpEndpoint', display: 'MCP 주소', description: '이 서버의 MCP 주소' },
    { name: 'app.origin', display: '앱 주소', description: '이 앱의 주소' },
  ],
  conditions: [{ name: 'app.customMcpServer', tag: '(기본 주소가 아닌 서버만)', description: '기본 주소가 아닌 서버만' }],
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

/** 검색 결과(WP-1509) — 관리자가 보는 세 절. 첫째를 열면 「실행」 본문, 나머지 둘이 「다른 결과」 칩이 된다. */
export const helpSearchHitsFixture: HelpSearchHit[] = [
  { chapter: 'agents', sectionId: 'agent.run', label: '실행', title: '실행을 설정한다', snippet: '실행 본문. 아이디는 에이전트 아이디 이다.' },
  { chapter: 'home', sectionId: 'home.widgets', label: '위젯', title: '위젯을 고른다', snippet: '위젯 본문.' },
  { chapter: 'agents', sectionId: 'agent.run.repo', label: '저장소 연결', title: '저장소를 연결한다', snippet: '저장소 연결 본문.' },
]

/**
 * 도움말 검색 응답 핸들러(`GET /api/v1/help/search`). 받은 질의를 `queries` 에 모은다.
 * @param respond 질의마다 결과(또는 응답)를 정한다 — 기본은 늘 helpSearchHitsFixture.
 */
export function helpSearchHandler(
  queries: string[] = [],
  respond: (q: string) => HelpSearchHit[] | Response | Promise<HelpSearchHit[] | Response> = () => helpSearchHitsFixture,
): RequestHandler {
  return http.get('/api/v1/help/search', async ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? ''
    queries.push(q)
    const out = await respond(q)
    return out instanceof Response ? out : HttpResponse.json({ mode: 'SEMANTIC', results: out })
  })
}
