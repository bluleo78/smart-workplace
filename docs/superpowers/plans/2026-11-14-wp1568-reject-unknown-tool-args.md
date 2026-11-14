# WP-1568 — MCP 도구가 모르는 인자 이름을 조용히 버린다

## 문제
`apps/workplace-mcp/src/mcp/server.ts` 의 `registerTool` 과 `apps/workplace-ai-agent/src/agent/sdk-mcp-server.ts` 의 `adaptMcpTool` 이 도구 입력 스키마로 `ZodObject.shape`(raw shape)를 넘긴다. SDK 는 그 shape 로 기본 `z.object`(모르는 키 strip)를 만들어 검증하므로 `description`·`parentKey` 같은 틀린 이름이 오류 없이 사라지고 호출이 성공한다.

## 방향
- 공유 패키지 `packages/mcp-tools-shared` 에 「모르는 인자」 판정 헬퍼 하나를 둔다 — 도구 입력 스키마(ZodObject)의 키 목록과 들어온 인자 객체의 키를 비교해, 모르는 키가 있으면 오류 문구를 돌려준다(없으면 null).
  - 문구: `알 수 없는 인자: description, parentKey — 쓸 수 있는 인자: projectKey, title, …`
  - 아는 키의 값이 null 인 것은 막지 않는다(WP-346). 막는 것은 모르는 키뿐이다.
- 두 서버 모두 SDK 가 strip 하기 **전의** 원래 인자를 보고 판정해야 한다. 지금처럼 shape 를 넘기면 핸들러가 받는 args 는 이미 strip 된 뒤라 판정할 수 없다 — 등록 시 SDK 에 넘기는 스키마가 모르는 키를 남기도록(예: `.passthrough()`/`z.looseObject` 로 감싼 객체 스키마를 넘김 — SDK 버전이 ZodObject 를 받는지 확인) 바꾸거나, 다른 확실한 방법을 쓴다. 어떤 방법이든 판정 → 모르는 키면 실행하지 않고 `isError: true` + 문구, 아니면 지금처럼 핸들러 실행.
- tools/list 응답(공유 `toolDefinition()` 출력)은 바뀌지 않아야 한다. ai-agent 쪽은 SDK 가 도구 정의를 shape 에서 만들므로, 스키마 전달 방식을 바꿀 때 모델에 보이는 스키마가 달라지지 않는지(예: additionalProperties) 확인한다.
- 모든 도구에 일괄 적용(등록·어댑터 한 곳).

## 테스트
- 공유 헬퍼 단위 테스트(모르는 키·null 값·키 없음).
- workplace-mcp: 실제 MCP 클라이언트(InMemoryTransport 등 기존 테스트 방식)로 `create_issue` 에 `description`·`parentKey` 를 넣어 부르면 API 호출 없이 isError + 문구, 올바른 인자(null 포함)는 그대로 동작.
- workplace-ai-agent: `adaptMcpTool`/SDK 서버 경로로 같은 검증.
- tools/list 스냅샷·크기 상한 테스트가 그대로 통과.
