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
| `tool-apps.ts` | `TOOL_APPS`·`ToolApp`·`toolApps()` — 도구를 앱으로 묶는 분류(WP-350, 아래 "앱 분류")와 서버 `instructions` 에 쓰는 앱별 안내(`TOOL_APP_GUIDES`) |
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

## 앱 분류 (WP-350)

외부 MCP 클라이언트(Claude.ai·ChatGPT)는 연결한 서버의 도구 정의를 전부 싣는다. 그래서 연결할 때 앱을 고를 수 있도록 공유 도구마다 `app` 태그를 둔다. `SharedTool.app` 은 **필수**라 빠뜨리면 타입 오류가 나고, `tool-apps.test.ts` 가 값의 유효성·앱별 도구 존재·도구별 분류 스냅샷을 확인한다.

- 앱 이름은 URL·헤더에 쓰는 값이라 소문자 영문이다: `issue`·`project`·`wiki`·`drive`·`mail`·`messaging`·`calendar`·`contacts`·`notify`·`member`. 새 앱은 `TOOL_APPS` 와 `TOOL_APP_GUIDES` 에 함께 추가한다.
- 분류는 파일이 아니라 **도구 단위**다. `list_issues` 는 `project-tools.ts` 에 있지만 `issue`, `list_contacts`·`get_external_contact` 는 `member-tools.ts` 에 있지만 `contacts` 다.
- **한 도구가 여러 앱에 속할 수 있다**(`app: ['issue', 'drive']`). 그 앱 중 하나만 골라도 도구가 보여야 그 앱 안에서 일이 끊기기 때문이다. 꼭 필요한 선행 조회만 겹치고, "있으면 편한" 수준으로는 퍼뜨리지 않는다.
  - `read_attachment`: 이슈 첨부와 드라이브 파일을 모두 읽는다 → `issue`, `drive`.
  - `list_projects`·`get_project`: 이슈 작업의 출발점(projectKey·담당자·라벨·마일스톤 목록)이다 → `project`, `issue`.
  - `search_members`: username 을 받는 도구(일정 참석자·프로젝트/채널 멤버·DM·멘션·그룹 멤버)가 설명에서 이 도구로 확인하라고 한다 → `member`, `calendar`, `project`, `messaging`, `contacts`. `mail`·`issue` 에는 싣지 않는다 — `create_issue`(`_from_mail`)의 assignees 는 선택 입력이고("me" 가능) 안내가 `get_project` 의 members 를 가리키며, 어느 설명도 `search_members` 를 가리키지 않는다.
  - 재발 방지: `tool-apps.test.ts` 가 도구 설명·입력 필드 설명에 나온 다른 공유 도구가 같은 앱 범위에도 있는지 대조한다. 대비·대안 언급처럼 선행 조회가 아닌 경우만 그 테스트의 `CROSS_REF_ALLOWED` 에 이유와 함께 올린다.

| 앱 | 도구 |
|---|---|
| `issue` | `list_issues` `get_issue_detail` `create_issue` `update_issue` `add_comment` `update_comment` `add_issue_dependency` `remove_issue_dependency` `watch_issue` `unwatch_issue` + 겹침: `list_projects` `get_project` `read_attachment` |
| `project` | `list_projects` `get_project` `create_project` `update_project` `add_project_member` + 겹침: `search_members` |
| `wiki` | `list_wiki_spaces` `list_wiki_pages` `search_wiki` `get_wiki_page` `list_wiki_backlinks` `create_wiki_page` `update_wiki_page` `move_wiki_page` |
| `drive` | `list_drive_spaces` `list_drive_items` `search_drive` `get_drive_file_summary` `search_drive_content` `list_drive_trash` `restore_drive_item` `create_drive_folder` `rename_drive_folder` `move_drive_folder` `move_drive_file` + 겹침: `read_attachment` |
| `mail` | `list_mail_accounts` `list_mail` `get_mail` `get_mail_summary` `draft_mail_reply` `draft_issue_from_mail` `create_issue_from_mail` `mark_mail_read` `sync_mail` |
| `messaging` | `list_channels` `discover_channels` `list_channel_messages` `list_thread_replies` `add_channel_message` `create_channel` `open_dm` `leave_channel` `add_channel_member` + 겹침: `search_members` |
| `calendar` | `list_events` `get_event` `rsvp_event` `create_event` `update_event` + 겹침: `search_members` |
| `contacts` | `list_contacts` `get_external_contact` `get_contact_facets` `add_contact_favorite` `remove_contact_favorite` `list_user_groups` `get_user_group` `create_user_group` `update_user_group` `add_user_group_member` `remove_user_group_member` `create_external_contact` `update_external_contact` + 겹침: `search_members` |
| `notify` | `list_notifications` `mark_notification_read` `mark_all_notifications_read` |
| `member` | `search_members` `get_member` `get_member_contact` |

workplace-mcp 는 이 태그로 `/mcp/x/{apps}`·`X-MCP-Toolsets` 연결을 걸러낸다(`apps/workplace-mcp/CLAUDE.md` "연결 범위"). 앱 선택은 노출 기준(`kind`)과 별개다 — destructive 는 어느 연결에서도 노출하지 않는다. AI Chat(ai-agent)은 `app` 을 쓰지 않는다.

## 목록 도구의 페이지 출력 (WP-352)

서버가 페이지를 지원하는 목록 도구는 잘렸다는 사실과 이어 읽을 값을 출력에 싣는다. 페이지를 버리고 첫 페이지만 주면 LLM 이 일부를 전부로 오해해 집계·요약한다. 출력은 `{ items, ... }` 객체이고 **다음 페이지가 없으면 `hasMore`·다음 값 키를 생략한다**(null·false 를 싣지 않는다 — 빠진 키 = 끝). 헬퍼는 `compact.ts` 의 `cursorPageView`·`numberedPageView` 다.

| 도구 | 입력 | 출력 | 서버 근거 |
|---|---|---|---|
| `list_issues` | `cursor`, `size`(기본 30·최대 100) | `{ items, hasMore?, nextCursor? }` | `IssueSearchResponse`(`MeIssuesController`) |
| `list_channel_messages` | `cursor`, `limit`(기본 50·최대 100) | `{ items, hasMore?, nextCursor? }` | `MessagePage`(`MessageController`) |
| `list_projects` | `page`, `size` | `{ items, total, hasMore?, nextPage? }` | `PageResponse`(`ProjectController`) |
| `search_members` | `page`, `size` | `{ items, total, hasMore?, nextPage? }` | `PageResponse`(`MemberController`) |
| `list_notifications` | `offset`, `limit` | `{ unreadCount, items, hasMore?, nextOffset? }` | 평면 목록 + offset(`NotificationController`) |
| `list_contacts` | `cursor`, `limit` | `{ items, hasMore?, nextCursor? }` | `ContactPage`(`ContactController`) — 서버는 `nextCursor` 만 주므로 도구가 `hasMore:true` 를 함께 싣는다 |

- 서버 `PageResponse` 에는 `last` 가 없어 다음 페이지 여부를 `page + 1 < totalPages` 로 계산한다.
- `list_issues`(서버가 `size` 건을 채우면 `hasMore` — 마지막 페이지가 정확히 `size` 건이면 빈 다음 페이지가 올 수 있다)와 `list_notifications`(총 개수를 안 줘 한 페이지가 꽉 차면 `hasMore`)만 `hasMore` 가 true 여도 다음 페이지가 비어 있을 수 있다. 설명이 이를 안내한다. `list_channel_messages`(서버가 limit+1 로 조회)와 번호 페이지 도구(`totalPages` 로 계산)는 정확하다.
- `list_notifications` 의 `nextOffset` 은 서버 목록 기준 위치다. `unreadOnly` 에서는 마지막으로 담은 행 바로 뒤를 가리킨다.
- 서버에 페이지가 없는 목록은 위 표 대상이 아니다. 아래 표처럼 도구가 limit 으로 자르고 이어 읽을 수 있으면 `hasMore`+`nextOffset`(`list_drive_items`·`list_channels`), 이어 읽을 수 없고 검색어를 좁혀야 하면 `truncated` 로 알린다. `truncated` 는 **잘렸을 때만 `truncated:true` 를 싣고 아니면 생략**한다(`list_thread_replies` 포함. 헬퍼 `truncatedView`).
- 설명에는 "`hasMore` 가 있으면 `nextCursor` 로 이어 조회하거나, 이어 조회하지 않고 답한다면 일부만 담겼다고 밝히라"를 적는다. AI Chat 의 subagent `agent.md` 와 라우터 프롬프트에도 같은 안내가 있다.

### 서버 페이지가 없는 목록 (WP-352)

| 도구 | 입력 | 출력 | 방식 · 근거 |
|---|---|---|---|
| `list_drive_items` | `limit`(기본 200·최대 500), `offset` | `{ folders, files, hasMore?, nextOffset? }` | **서버 페이지 추가** — `DriveFolderController` `/spaces/{id}/items` 에 선택 `limit`·`offset`(폴더 먼저·파일 다음 합본 순서, SQL 에서 자름). 파라미터가 없으면 전체(웹 브라우즈 그대로). 폴더 하나에 수천 항목이 있을 수 있고 파일 행마다 저장소 존재 확인이 있다. 도구는 `limit+1` 로 다음 페이지를 확인한다 |
| `list_wiki_pages` | `parentId?` | `{ items(트리), total, truncated? }` | 도구 상한 500노드(너비 우선). 평면 목록을 잘라 트리를 만들면 고아가 최상위로 올라 계층이 거짓이 되므로 서버 페이지는 두지 않았다. 잘린 노드의 `hiddenChildren` + `parentId` 로 하위를 펼친다 |
| `list_channels` | `limit`(기본 100·최대 200), `offset` | `{ items, total, hasMore?, nextOffset? }` | 도구 상한(서버 페이지는 없지만 이어 읽을 수 있어 `list_drive_items`·`list_notifications` 와 같은 `hasMore`+`nextOffset`). 내 채널 수라 유계이고 웹 사이드바(`useMyChannels`)가 전체를 쓰므로 서버는 그대로. 이름순 offset 으로 이어 읽는다 |
| `search_drive` | `limit`(기본 50·최대 200, 폴더·파일 각각) | `{ folders, files, truncated? }` | 서버가 각각 200건에서 조용히 자른다(`searchByName` `.limit(200)`) — 도구 limit 을 넘거나 서버 상한 200 에 닿으면 `truncated` |
| `search_wiki` | — | `{ items, truncated? }` | 서버가 최근 수정순 50건에서 조용히 자른다(`WikiPageService.search`) — 50건에 닿으면 `truncated` |

서버가 상한을 조용히 거는 검색은 "상한에 닿음 = 잘렸을 수 있음" 으로 본다(정확히 상한만큼이 전부일 수도 있다). 이어 조회할 수단이 없어 검색어를 좁히라고 안내한다. 서버 상한을 바꾸면 도구 상수(`SEARCH_SERVER_CAP`)도 맞춘다.


### 응답 크기 — 정리 뷰

서버 DTO 를 그대로 내보내지 않고 LLM 이 판단에 쓰는 필드만 남긴다(WP-353). 화면(웹)이 쓰려고 서버가 실어 보내는 값(색·아바타용 이름·읽음 워터마크·내부 헤더 id)과 행마다 반복되는 값(채널 id·null·`false`·`0`)이 토큰의 대부분을 차지하기 때문이다. 원칙:
- **허용 목록이 아니라 제거 목록**이다(`compact.ts` 의 `omitKeys`). 서버에 새 필드가 생겨도 조용히 사라지지 않는다.
- 값이 없는 키(null·빈 배열)는 `dropEmpty` 로 생략한다. 키가 없다 = 값이 없다. 반복되는 기본값(`unreadCount:0`·`archived:false`·`deleted:false`)도 같은 뜻으로 생략하고 설명에 적는다.
- 가공은 도구 핸들러에서만 한다(rest-client 는 raw). 같은 서버 DTO 를 내보내는 도구는 모두 같은 뷰를 쓴다.
- 코멘트·이력처럼 길어지는 하위 목록은 최근 N건만 싣고, 잘리면 빠진 개수(`commentsOmitted`·`historyOmitted`)를 알린다. 더 읽는 방법(`allComments`)을 설명에 적는다.
- 메일 본문은 평문 `bodyText` 하나다. 평문이 비어 있고 HTML 만 있으면 `html-text.ts` 의 `htmlToText` 로 바꿔 채운다.

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
- **계속 빼 둘 것**: 메일 발송, 영구 삭제, 외부 공유 링크, 구성원 권한 변경. 권한 부여도 권한 변경이라 `add_project_member` 는 MEMBER 로만 추가하고, OWNER 로 들이는 것은 확인 카드(`propose_add_project_member`)만 한다(WP-349).

### AI Chat 과의 관계

- 같은 작업은 실행 경로마다 도구를 하나만 둔다. AI Chat 은 확인 카드(`propose_*`), 외부 MCP 는 직접 실행 도구다. assistant·subagent 에 둘을 함께 싣지 않는다.
- 공유 도구를 바꾸면 subagent `agent.md`, 라우터 프롬프트, `TOOL_LABELS`(웹 `LEGACY_TOOL_LABELS` 포함), ai-driven-agent-inspector 회귀 점검까지 함께 고친다.
- AI Chat 라우터는 직접 쓰는 도구(읽기·`show_*`·알림·첨부 읽기)만 싣는다(ai-agent `ASSISTANT_ROUTER_TOOLS`, Claude 경로, WP-351). 쓰기·`propose_*` 는 담당 subagent 에만 둔다. assistant 프로필에 도구를 더하면 라우터 목록이나 담당 subagent frontmatter 중 한 곳에 넣는다 — 어느 쪽에도 없으면 `subagent-loader.test.ts` 가 실패한다.

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
- 아직 따르지 않는 기존 이름은 두 테스트 파일의 예외 배열(`SHARED_NAMING_EXCEPTIONS`, `LOCAL_NAMING_EXCEPTIONS`)에 적혀 있고, 항목마다 바꿀 이슈가 주석으로 달려 있다. 지금은 둘 다 비어 있다(마지막 항목 `get_channel_messages` 는 WP-352 가 `list_channel_messages` 로 바꾸며 비웠다). 예외 이름이 더는 존재하지 않으면 테스트가 실패해 낡은 항목을 지우게 한다.
- `get_` 이 여러 건을 돌려주는지는 기계로 가릴 수 없어, 알려진 도구를 예외 배열에 직접 적는다. 새 도구는 만들 때 `list_` 를 고른다.

## 파라미터 명명 규칙

1. **도메인 접두 id**: 숫자 식별자는 무엇의 id 인지 이름에 드러낸다.
   - 예: `eventId`, `pageId`, `spaceId`, `channelId`, `accountId`, `messageId`, `folderId`, `driveFileId`, `attachmentId`, `externalId`, `commentId`, `notificationId`
   - **출력도 같은 이름**이다(WP-353): 채널 목록·검색·생성은 `channelId`, 드라이브 폴더 목록·검색·생성·이름변경·휴지통은 `folderId`, 이슈 첨부는 `attachmentId`(서버의 core file id — 드라이브 `driveFileId`·채팅 첨부 `fileId` 와 섞이지 않게 이름을 달리했다. 이슈 챗 전용 `read_chat_thread_attachment` 의 `fileId` 는 같은 이슈 첨부를 가리키므로 `read_attachment` 의 `attachmentId` 와 같은 값이다). 입력 이름과 출력 이름이 어긋나면 모델이 `id` 를 아무 데나 넣는다.
   - `messageId` 는 메일(`get_mail`)과 채팅 메시지(`list_thread_replies`)에서 같이 쓴다. 도구 이름이 도메인을 정하므로 설명에 어느 결과의 id 인지 적는다.
   - 맨 이름 `id` 는 입력 파라미터로 쓰지 않는다. 실행기나 서버가 `id` 를 읽는다면 핸들러가 옮겨 담는다. 예: `propose_update_event` 는 `{ id: eventId }` 로 옮긴다.
2. **같은 것은 같은 이름**: 조회 도구와 쓰기 도구, 표시 위젯이 같은 대상을 같은 이름으로 가리킨다.
   - 프로젝트는 어디서나 `projectKey`, 이슈는 `issueKey`(`WP-12`) 다. 부모 이슈(`create_issue`·`update_issue` 의 `parent`)와 의존성 링크(`blockedBy`·`blocks`)도 번호가 아니라 이슈 키다 — 서버는 같은 프로젝트의 번호만 받아 핸들러가 키에서 번호를 떼어 보내고, 다른 프로젝트 키는 쓰기 전에 거부한다(WP-353).
   - 서버 DTO 가 `key` 를 읽으면 핸들러가 `{ key: projectKey }` 로 옮기고, 서버가 주는 프로젝트 응답의 `key` 는 출력에서 `projectKey` 로 이름을 바꾼다(`list_projects`·`get_project`·`create_project`·`update_project` — 출력 식별자 이름 = 입력 이름). 이전 클라이언트가 읽던 `key` 는 이 릴리스에서 사라진다(WP-360 공지 대상).
3. **사람은 username**: 사람을 가리키는 입력은 `username` 이다. `assignees` 같은 목록은 username 배열이다. 숫자 `userId` 는 입력으로 받지 않고, 출력에서도 내보내지 않는다(#833). `ownerId`·`updatedBy`·`authorId`·`reporterId`·`invitedByUserId` 같은 사용자 ID 필드도 마찬가지다. 서버가 이름을 함께 주면 `{username, name}`(일정 참석자. `invitedBy` 는 같은 응답의 참석자에서 풀어 쓴다)이나 `authorName` 으로 두고, 이름이 없고 쓸 곳도 없는 값(스페이스·프로젝트 `ownerId`, 노트 `updatedBy`)은 뺀다. `list_contacts` 의 MEMBER 항목은 서버 연락처 요약이 싣는 `username`(숫자 `userId` 는 내보내지 않는다)이고, 메시지 본문의 멘션 토큰 `<@id>` 는 `@이름(username)` 으로 풀어 `mentions[].id` 와 함께 숫자를 없앤다(풀 수 없는 토큰은 `@(알 수 없는 사용자)`). 남은 예외는 둘이고 후속으로 남겼다: `get_wiki_page` 본문과 ai-agent `list_chat_messages` 본문(이슈 챗 메시지)에는 `<@id>` 토큰이 그대로 남는다(풀 멘션 사전이 응답에 없다). `no-user-ids.test.ts` 가 서버 DTO 모양의 목으로 도구 횡단 검사(금지 키·username+id·문자열 안 `<@id>` 토큰)를 하고, `get_wiki_page` 본문만 이유를 적은 명시적 예외 목록으로 둔다(ai-agent 쪽은 이 패키지 밖이라 검사하지 않는다).
4. **구성원과 외부 연락처는 네임스페이스가 다르다**: 구성원은 `username`, 외부 연락처는 `externalId` 를 쓴다. 공용 `id` 필드로 섞어 내보내지 않는다.
5. **이름으로 지정할 수 있으면 이름으로 받는다**: 유형·라벨은 이름(`type`, `labels`)으로 받고 서버나 핸들러가 id 로 해석한다. 모르는 값이면 사용 가능 목록을 담은 오류를 돌려 LLM 이 스스로 고칠 수 있게 한다.
6. **불리언 필터는 의미를 드러낸다**: 예를 들어 `unreadOnly` 다. 서버 쿼리 이름(`unread`)과 다르면 클라이언트가 옮겨 담는다.
7. **자유 텍스트 검색어**: 새 도구는 `query` 를 쓴다.
   - `search_drive`·`discover_channels`·`list_issues` 의 `q`, `search_members`·`list_contacts` 의 `search` 는 기존 이름이다.
   - 이 이름들은 ai-agent 의 `show_*` 위젯 params 와 프론트엔드가 공유하므로, 바꿀 때는 위젯 쪽도 함께 바꾼다.
