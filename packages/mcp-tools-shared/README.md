# @smart-workplace/mcp-tools-shared

workplace-mcp(사용자 PAT 원격 MCP)와 workplace-ai-agent(AI 비서 인-프로세스 MCP)가 **같이 쓰는 MCP 도구 정의**다.
스키마·설명·핸들러·REST 경로 매핑이 한 곳에만 있다.

두 앱이 도구를 각자 정의하던 때는 같은 이름의 도구가 서로 다른 파라미터를 받았다(`get_event` 의 `id`/`eventId`, `search_wiki` 의 `query`/`q` 등). 이 드리프트를 없애려고 정의를 한 곳으로 모았다(#846).

## 구성

| 파일 | 내용 |
|---|---|
| `tool-client.ts` | 도메인별 구조적 클라이언트 인터페이스. 클라이언트는 raw 를 그대로 반환한다 |
| `rest-client.ts` | `createSharedToolClient(http)` — 위 인터페이스를 REST 경로로 구현한다. 각 앱은 인증 헤더가 붙은 axios 인스턴스만 넘긴다 |
| `*-tools.ts` | 도메인별 도구 정의(이슈·프로젝트·노트·캘린더·메일·구성원/연락처·메시징·드라이브·알림) |
| `shared-tools.ts` | `buildSharedTools(client, opts)` — 공유 도구 전체 |

LLM 에 보여줄 형태로 가공하는 일은 **도구 핸들러**가 맡는다. 식별자 이름 바꾸기나 숫자 id 제거가 여기에 해당한다. 클라이언트에 가공을 두면 앱마다 규칙이 달라진다.

## 앱에서 쓰는 법

- **workplace-mcp**: `buildSharedTools(createPatApiClient(...))` 에서 `kind: 'destructive'` 를 뺀 나머지를 노출한다. PAT 에는 스코프가 없고 확인 카드도 없어서다.
- **workplace-ai-agent**: 프로필별로 `sharedTool('이름')` 을 골라 쓴다. 에이전트 전용 도구(`propose_*`, `show_*`, `submit_response`, `unassign_self`, `update_status`, chat, 위임)만 앱에서 직접 정의한다.
- 공유 도구와 **같은 이름의 도구를 앱에서 다시 정의하지 않는다.** 두 앱의 패리티 테스트가 이름과 `z.toJSONSchema(inputSchema)` 의 일치를 강제한다. ai-agent 에서 안내 문구만 덧붙일 때는 공유본을 펼치고 `description` 만 바꾼다(`list_issues` 가 그 예).
- `inputSchema` 는 반드시 최상위 `z.object(...)` 여야 한다. 서버 레이어가 `.shape` 를 꺼내 등록하기 때문이다. 공유 패키지 소스를 바꾸면 `pnpm --filter @smart-workplace/mcp-tools-shared build` 를 먼저 돌린다(앱은 `dist` 를 import 한다).

## 도구 등급(kind)

공유 도구는 `SharedTool` 이고 `kind` 가 필수다(#853). 빠뜨리면 타입 오류가 난다.

| kind | 기준 | 예 | workplace-mcp |
|---|---|---|---|
| `read` | 상태를 바꾸지 않는다 | `list_issues`, `get_mail` | 노출(`readOnlyHint`) |
| `write` | 바꾸지만 되돌릴 수 있다. 워크스페이스 안의 알림·메시지는 앱에서 직접 해도 생기는 정상 부작용이라 여기에 든다 | `update_issue`, `rsvp_event`, `open_dm` | 노출 |
| `destructive` | 되돌릴 수 없거나(영구 삭제) 워크스페이스 밖으로 나간다(메일 발송·외부 공개 링크) | (없음) | **비노출**(`destructiveHint`) |

되돌릴 수 없는 작업이나 대외 발송은 공유 도구보다 ai-agent 의 `propose_*` 확인 카드로 만드는 것이 원칙이다. 등급과 노출 목록은 `shared-tools.test.ts` 와 workplace-mcp `tools/index.test.ts` 의 스냅샷이 고정한다.

## 파라미터 명명 규칙

1. **도메인 접두 id**: 숫자 식별자는 무엇의 id 인지 이름에 드러낸다.
   - 예: `eventId`, `pageId`, `spaceId`, `channelId`, `accountId`, `messageId`, `folderId`, `driveFileId`, `externalId`, `commentId`, `notificationId`
   - `messageId` 는 메일(`get_mail`)과 채팅 메시지(`get_thread_replies`)에서 같이 쓴다. 도구 이름이 도메인을 정하므로 설명에 어느 결과의 id 인지 적는다.
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
