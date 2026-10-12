# @smart-workplace/mcp-tools-shared

workplace-mcp(사용자 PAT 원격 MCP)와 workplace-ai-agent(AI 비서 인-프로세스 MCP)가 **같이 쓰는 MCP 도구 정의**다.
스키마·설명·핸들러·REST 경로 매핑이 한 곳에만 있다.

두 앱이 도구를 각자 정의하던 때는 같은 이름의 도구가 서로 다른 파라미터를 받았다(`get_event` 의 `id`/`eventId`, `search_wiki` 의 `query`/`q` 등). 이 드리프트를 없애려고 정의를 한 곳으로 모았다(#846).

## 구성

| 파일 | 내용 |
|---|---|
| `tool-client.ts` | 도메인별 구조적 클라이언트 인터페이스. 클라이언트는 raw 를 그대로 반환한다 |
| `rest-client.ts` | `createSharedToolClient(http)` — 위 인터페이스를 REST 경로로 구현한다. 각 앱은 인증 헤더가 붙은 axios 인스턴스만 넘긴다 |
| `*-tools.ts` | 도메인별 도구 정의(이슈·프로젝트·노트·캘린더·메일·구성원/연락처·메시징·드라이브·알림·첨부(`attachment-tools.ts`)) |
| `attachment-read.ts` | 첨부·파일 내용 읽기의 공통 계약 — 구간 범위(`readRangeShape`)·기본 길이·이미지 형식/크기 판정. 공유 `read_attachment` 와 ai-agent 전용 채팅 첨부 읽기 도구가 같이 쓴다 |
| `shared-tools.ts` | `buildSharedTools(client, opts)` — 공유 도구 전체 |
| `tool-naming.ts` | `toolNameViolations(name)` — 도구 이름 규칙 검사(아래 "도구 명명 규칙"). 두 앱의 테스트가 쓴다 |

LLM 에 보여줄 형태로 가공하는 일은 **도구 핸들러**가 맡는다. 식별자 이름 바꾸기나 숫자 id 제거가 여기에 해당한다. 클라이언트에 가공을 두면 앱마다 규칙이 달라진다.

## 앱에서 쓰는 법

- **workplace-mcp**: `buildSharedTools(createPatApiClient(...))` 에서 `kind: 'destructive'` 를 뺀 나머지를 노출한다. PAT 에는 스코프가 없고 확인 카드도 없어서다.
- **workplace-ai-agent**: 프로필별로 `sharedTool('이름')` 을 골라 쓴다. 에이전트 전용 도구(`propose_*`, `show_*`, `submit_response`, `unassign_self`, chat, 위임)만 앱에서 직접 정의한다.
- 공유 도구와 **같은 이름의 도구를 앱에서 다시 정의하지 않는다.** 두 앱의 패리티 테스트가 이름과 `z.toJSONSchema(inputSchema)` 의 일치를 강제한다. ai-agent 에서 안내 문구만 덧붙일 때는 공유본을 펼치고 `description` 만 바꾼다(`list_issues` 가 그 예).
- `inputSchema` 는 반드시 최상위 `z.object(...)` 여야 한다. 서버 레이어가 `.shape` 를 꺼내 등록하기 때문이다. 공유 패키지 소스를 바꾸면 `pnpm --filter @smart-workplace/mcp-tools-shared build` 를 먼저 돌린다(앱은 `dist` 를 import 한다).

## 도구 등급(kind)

공유 도구는 `SharedTool` 이고 `kind` 가 필수다(#853). 빠뜨리면 타입 오류가 난다.

| kind | 기준 | 예 | workplace-mcp |
|---|---|---|---|
| `read` | 상태를 바꾸지 않는다 | `list_issues`, `get_mail` | 노출 |
| `write` | 바꾸지만 되돌릴 수 있다. 워크스페이스 안의 알림·메시지는 앱에서 직접 해도 생기는 정상 부작용이라 여기에 든다 | `update_issue`, `rsvp_event`, `open_dm` | 노출 |
| `destructive` | 되돌릴 수 없거나(영구 삭제) 워크스페이스 밖으로 나간다(메일 발송·외부 공개 링크) | (없음) | **비노출** |

`kind` 는 **노출 여부**만 정한다. MCP 클라이언트에 알리는 연산 성격(`destructiveHint`·`idempotentHint`·`openWorldHint`)은 `kind` 가 아니라 write·destructive 도구의 `hints`(`ToolHints`)에서 `toolAnnotations()` 가 만든다(WP-342, read 는 `readOnlyHint` 만). 기준은 `mcp-tool.ts` 의 `ToolHints` 주석이고, 도구별 전체 값은 `tool-annotations.test.ts` 가 고정한다. 그래서 `kind: 'write'` 여도 덮어쓰거나 지우는 도구는 `destructiveHint` 가 true 다.

등급과 노출 목록은 `shared-tools.test.ts` 와 workplace-mcp `tools/index.test.ts` 의 스냅샷이 고정한다.

## 노출 기준 (WP-347)

외부 MCP(workplace-mcp)에 어떤 작업을 도구로 내놓을지는 부작용의 등급 R/W/I/N 으로 정한다. 등급은 `kind`·`hints` 로 코드에 드러난다.

| 등급 | 뜻 | 코드 표현 | 외부 MCP |
|---|---|---|---|
| R | 읽기 | `kind: 'read'` | 노출 |
| W | 되돌릴 수 있는 쓰기 | `kind: 'write'` + `hints`. 덮어쓰거나 지우면 `hints.destructive: true` | 노출. 확인은 annotation 을 읽는 클라이언트에 맡긴다 |
| I | 되돌릴 수 없음(영구 삭제)·워크스페이스 밖으로 나감(메일 발송·외부 공유 링크) | `kind: 'destructive'` | **노출하지 않는다.** AI Chat 에서만 `propose_*` 확인 카드로 한다 |
| N | 다른 사람에게 알림이 간다 | 별도 필드 없음. R/W 등급 위에 얹는 표시다 | 알림 여부를 **입력**으로 받는다. 해당 도구를 만들 때 적용한다. 예: `create_event`·`update_event` 의 `notify`(false 면 초대 알림을 보내지 않는다, WP-348). 프로젝트 멤버 추가·채널 초대(WP-349)는 서버가 인박스·푸시 알림을 만들지 않아(상대 화면 목록 갱신 신호뿐) 입력이 없다 |

- `kind`(노출 여부)와 `hints`(연산 성격)는 별개 축이다(WP-342). I 는 `kind` 로 막고, W 가 덮어쓴다는 사실은 `hints` 로 알린다.
- **elicitation 에 기대지 않는다.** Claude.ai 지원이 확인되지 않았고 2026-07-28 스펙에서 MRTR 로 바뀐다. 확인은 클라이언트의 annotation 처리와 `propose_*` 확인 카드가 맡는다.
- **계속 빼 둘 것**: 메일 발송, 영구 삭제, 외부 공유 링크, 구성원 권한 변경.

### AI Chat 과의 관계

- 같은 작업은 실행 경로마다 도구를 하나만 둔다. AI Chat 은 확인 카드(`propose_*`), 외부 MCP 는 직접 실행 도구다. assistant·subagent 에 둘을 함께 싣지 않는다.
- 공유 도구를 바꾸면 subagent `agent.md`, 라우터 프롬프트, `TOOL_LABELS`(웹 `LEGACY_TOOL_LABELS` 포함), ai-driven-agent-inspector 회귀 점검까지 함께 고친다.

### 도구 수

- 새 도구보다 기존 도구의 파라미터 확장을 먼저 한다. 읽기는 상세 도구의 옵션으로 넣는다. 첨부 읽기는 `read_attachment` 하나로 모은다. 읽기와 쓰기는 한 도구에 섞지 않는다.
- 외부 MCP 기본 노출은 **85개 이하**다(destructive 제외, `tool-naming.test.ts` 가 강제).

## 도구 명명 규칙 (WP-347)

형식은 `동사_명사[_한정어]` snake_case 이고 **46자 이내**다(Anthropic API 도구 이름 64자 − 외부 MCP 접두 `mcp__genia-works__` 18자). `tool-naming.ts` 의 `toolNameViolations` 가 형식·길이·금지 접두를 검사한다.

| 구분 | 접두 | 쓰임 |
|---|---|---|
| 조회 | `list_` | 여러 건 |
| | `get_` | 한 건 |
| | `search_` | 검색어로 찾기 |
| | `read_` | 본문 읽기 |
| 쓰기 | `create_` / `update_` | 독립 리소스 |
| | `add_` / `remove_` | 관계·하위 항목 |
| 상태 짝 | `mark_*_read`, `watch_` / `unwatch_`, `join_` / `leave_` | |

- `edit_`·`save_`·`set_` 은 새로 쓰지 않는다. 여러 건을 돌려주는 도구는 `get_` 이 아니라 `list_` 다.
- 다른 도메인과 겹치는 명사는 도메인 접두를 붙인다. 예: `drive_file`, `drive_folder`, `channel_message`.
- ai-agent 전용 접두: 확인 카드는 `propose_<원 도구명>`(원 도구명에도 위 규칙을 적용해 `propose_set_*` 는 위반이다), 화면 표시는 `show_*`.
- 이름은 바꾸기 어렵다. 외부 사용자는 "항상 허용"을 다시 승인해야 한다. 그래서 기존 이름은 한 번에 정리하고 배포 때 공지한다(WP-360).

### 강제 방식

- 공유 도구는 `tool-naming.test.ts`, ai-agent 전용 도구는 ai-agent `tools.test.ts` 가 모든 이름에 `toolNameViolations` 를 돌린다.
- 아직 따르지 않는 기존 이름은 두 테스트 파일의 예외 배열(`SHARED_NAMING_EXCEPTIONS`, `LOCAL_NAMING_EXCEPTIONS`)에 적혀 있고, 항목마다 바꿀 이슈가 주석으로 달려 있다. WP-360 이 `get_channel_messages` 를 뺀 나머지를 바꿨고, 이 이름은 WP-352 가 `list_channel_messages` 로 바꾸며 배열을 비운다(`LOCAL_NAMING_EXCEPTIONS` 는 이미 비어 있다). 예외 이름이 더는 존재하지 않으면 테스트가 실패해 낡은 항목을 지우게 한다.
- `get_` 이 여러 건을 돌려주는지는 기계로 가릴 수 없어, 알려진 도구를 예외 배열에 직접 적는다. 새 도구는 만들 때 `list_` 를 고른다.

## 파라미터 명명 규칙

1. **도메인 접두 id**: 숫자 식별자는 무엇의 id 인지 이름에 드러낸다.
   - 예: `eventId`, `pageId`, `spaceId`, `channelId`, `accountId`, `messageId`, `folderId`, `driveFileId`, `externalId`, `commentId`, `notificationId`
   - `messageId` 는 메일(`get_mail`)과 채팅 메시지(`list_thread_replies`)에서 같이 쓴다. 도구 이름이 도메인을 정하므로 설명에 어느 결과의 id 인지 적는다.
   - 맨 이름 `id` 는 입력 파라미터로 쓰지 않는다. 실행기나 서버가 `id` 를 읽는다면 핸들러가 옮겨 담는다. 예: `propose_update_event` 는 `{ id: eventId }` 로 옮긴다.
2. **같은 것은 같은 이름**: 조회 도구와 쓰기 도구, 표시 위젯이 같은 대상을 같은 이름으로 가리킨다.
   - 프로젝트는 어디서나 `projectKey`, 이슈는 `issueKey`(`WP-12`) 다.
   - 서버 DTO 가 `key` 를 읽으면 핸들러가 `{ key: projectKey }` 로 옮긴다.
3. **사람은 username**: 사람을 가리키는 입력은 `username` 이다. `assignees` 같은 목록은 username 배열이다. 숫자 `userId` 는 입력으로 받지 않고, 출력에서도 가능하면 빼서 username 만 준다. 예외는 `list_contacts` 의 MEMBER 항목뿐이다.
4. **구성원과 외부 연락처는 네임스페이스가 다르다**: 구성원은 `userId`/`username`, 외부 연락처는 `externalId` 를 쓴다. 공용 `id` 필드로 섞어 내보내지 않는다.
5. **이름으로 지정할 수 있으면 이름으로 받는다**: 유형·라벨은 이름(`type`, `labels`)으로 받고 서버나 핸들러가 id 로 해석한다. 모르는 값이면 사용 가능 목록을 담은 오류를 돌려 LLM 이 스스로 고칠 수 있게 한다.
6. **불리언 필터는 의미를 드러낸다**: 예를 들어 `unreadOnly` 다. 서버 쿼리 이름(`unread`)과 다르면 클라이언트가 옮겨 담는다.
7. **자유 텍스트 검색어**: 새 도구는 `query` 를 쓴다.
   - `search_drive`·`discover_channels`·`list_issues` 의 `q`, `search_members`·`list_contacts` 의 `search` 는 기존 이름이다.
   - 이 이름들은 ai-agent 의 `show_*` 위젯 params 와 프론트엔드가 공유하므로, 바꿀 때는 위젯 쪽도 함께 바꾼다.
