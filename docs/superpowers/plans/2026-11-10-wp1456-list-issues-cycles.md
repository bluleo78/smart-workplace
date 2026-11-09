# WP-1456 list_issues 항목에 사이클 싣기 — 구현 계획

## 목표
MCP `list_issues` 항목에 `cycles: [{ name, status }]` 를 싣는다. 비어 있으면 생략하고, 도구 설명에 「cycles 가 없으면 사이클 없음」을 적는다.

## 원인·설계
- API `/me/issues` 는 이미 행마다 `cycles`(CycleSummary — id·name·status 등)를 일괄 조회로 싣는다
  (`IssueSearchService.assembleItems` → `withListExtras`, `issueCycleRepository.findCyclesByIssueIds` — N+1 없음). API 변경 없음.
- MCP 공유 변환 `toIssueListItem`(`packages/mcp-tools-shared/src/project-tools.ts`)이 이 필드를 버린다 — 여기만 고친다.
- 공유 도구 정의라 플러그인 MCP(`apps/workplace-mcp`)·ai-agent 가 함께 바뀐다. `show_issue_list`(ai-agent 화면 지시)는 항목 변환을 쓰지 않아 무관.

## 할 일
1. `tool-client.ts` 의 `IssueRow` 에 `cycles?: { name?: string; status?: string; [key: string]: unknown }[] | null` 추가(한국어 주석, WP-1456).
2. `toIssueListItem` 에 `cycles` 추가 — 각 항목 `{ name, status }` 만(숫자 id·기간은 뺀다, get_issue_detail 과 같은 모양). 배열이 아니거나 비면 빈 배열 → `dropEmpty` 가 키를 뺀다. 서버 순서(시작일 최신순)를 유지한다.
3. `list_issues` 설명의 Items 목록에 `cycles` 를 넣고 「empty omitted (no cycles = in no cycle)」처럼 생략 의미를 분명히 한다. 설명 길이 상한 테스트(`tool-definitions.test.ts` 등)를 통과해야 한다 — 짧게.
4. 테스트(`project-tools.test.ts`): 사이클 0개(키 없음)·1개·2개(ACTIVE+COMPLETED, 순서 유지, id·startDate 등 제외)가 섞인 목록을 `list_issues` 핸들러로 돌려 항목마다 cycles 가 정확한지. `cycles: null` 도 키 없음.
5. 스냅숏이 있으면(`__snapshots__`) 갱신하고 차이가 이 변경뿐인지 확인.

## Review Focus (완료 기준이 말하지 않은 입력·실패 경우)
- `cycles` 가 null·undefined·배열 아님 → 키 없음(예외 없이).
- 항목에 name 이 없는 이상 행 → 버리지 말고 있는 값만(또는 name 없는 항목은 제외) — 한 쪽으로 정하고 테스트.
- 설명 문구가 토큰 상한을 넘지 않는지.
- 다른 항목 필드(agentWork·sourceKey 등) 회귀 없음.

## 테스트 명령
- `pnpm --filter @smart-workplace/mcp-tools-shared test` → `pnpm --filter @smart-workplace/mcp-tools-shared build`
- `pnpm --filter @smart-workplace/workplace-mcp test` · `pnpm --filter @smart-workplace/workplace-ai-agent test` · `cd apps/workplace-web && pnpm test`
- `pnpm lint` · `pnpm typecheck`

## 라이브 확인
격리 스택(`LIVE_STACK_NAME=work-loop`)에서 사이클 0·1·2개 이슈를 만들어 `/me/issues` 응답과 MCP 변환 결과를 비교, `cycle=backlog`·`none` 필터와 일치하는지 본다.
