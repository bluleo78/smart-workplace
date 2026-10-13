# MCP 도구 전수 조사 · 경쟁 비교 · 개선안 (WP-340)

작성일: 2026-10-12 (코드 크로스체크 반영) · 기준 커밋: main `570f1334` · 관련: WP-340(에픽), #846(공유 패키지), #853(PAT 노출 등급), #833(식별자 정책), #841(이름 해석)

목적: 외부 MCP(genia-works, PAT)와 AI Chat(ai-agent)이 쓰는 MCP 도구를 앱별로 전수 조사하고, 경쟁사 공식 MCP 서버와 비교해 보강안을 뽑는다.

---

## 0. 요약

- **커버리지**: 공유 도구 63개가 외부 MCP 에 그대로 노출된다(main 스냅샷 = prod, 차이 없음). ai-agent 전용은 assistant 기준 50개(업무 35 + `show_*` 15), 모든 프로필 합계 54개. API 는 있는데 외부 MCP 에서 못 하는 일이 앱마다 있다.
- **가장 큰 공백 세 가지**
  1. **파일·첨부 내용을 어디서도 읽을 수 없다.** 이슈 첨부는 백엔드 `/text` API 가 이미 있는데도 도구가 없다. 경쟁사(Google·Dropbox·Box·OneDrive)는 모두 "텍스트로 읽기" 도구를 기본 제공한다.
  2. **캘린더는 조회·RSVP 만 된다.** 생성·수정은 ai-agent 확인 카드(`propose_*`) 뒤에만 있어 외부 MCP 에 없다. Google·MS 는 `create_event` 를 바로 제공한다.
  3. **드라이브 쓰기가 ai-agent 에만 있다.** #846 공유 이동 때 빠진 것으로 보인다(연락처·메일 동기화·채널 탐색도 같음).
- **조사 중 발견한 결함 (최우선)**: `apps/workplace-mcp/src/mcp/server.ts:25` 가 모든 write 도구에 `destructiveHint:false` 를 보낸다. MCP 명세에서 false 는 "추가만 하는 변경"이다. `update_issue`·`update_wiki_page`·`remove_*`·`leave_channel` 처럼 덮어쓰거나 지우는 도구가 클라이언트에 "안전한 추가"로 잘못 알려지고 있다.
- **품질 결함**: `list_issues`·`get_channel_messages` 가 서버 cursor 를 버려 잘린 결과를 모른다. 응답에 숫자 ID·원문 HTML 이 그대로 섞인다(#833 위반). 도구 설명과 실제 동작이 어긋나는 곳이 있다.
- **AI Chat 연계**: 공유 도구는 AI Chat 도 쓴다. 바꿀 때마다 subagent `agent.md`·프롬프트·라벨·회귀 점검까지 함께 반영해야 하고, 같은 작업은 경로마다 도구 하나(AI Chat 은 확인 카드, 외부 MCP 는 직접 실행)로 둔다(§5).
- **도구 이름 규칙이 없다**: 목록인데 `get_`, `edit_`/`update_` 혼용, 드라이브 접두 불일치. 규칙을 정하고 한 번에 정리한다(§6).
- **확인(confirm) 방식**: elicitation 은 Claude.ai 지원이 확인되지 않고 2026-07-28 스펙에서 방식이 바뀐다. 경쟁사처럼 **annotation + 서버 측 미리보기→확정(plan-then-commit)** 으로 가는 것이 맞다. 우리 `propose_*` 가 이미 그 형태다.
- **권장 순서**: 기반 정비(annotation·반환 타입·페이지) → 공유 이동 → 첨부·파일 읽기 → 캘린더 쓰기와 노출 기준 → 앱별 보강.

---

## 1. 조사 방법과 범위

- **우리 코드**: 백엔드 컨트롤러(`apps/workplace-api/.../controller`), 공유 도구(`packages/mcp-tools-shared/src/*-tools.ts`)와 실제 호출 경로(`rest-client.ts`), 응답 뷰(`issue-detail.ts`·`drive-view.ts`·`compact.ts`), 외부 노출(`apps/workplace-mcp/src/tools/index.ts` + 스냅샷), ai-agent 전용(`apps/workplace-ai-agent/src/mcp/tools.ts`·`home-attachment-tool.ts`), subagent 정의(`agent.md`). 이름 대조가 아니라 핸들러·응답 뷰까지 읽어 확인했다.
- **prod 확인**: 운영 genia-works MCP 가 노출하는 도구 목록과 main 스냅샷을 diff — 동일.
- **경쟁사**: Atlassian Rovo, Notion, Linear, GitHub, Slack, Google Workspace, Microsoft 365(Work IQ), Box, Dropbox, Asana, ClickUp 의 공식 문서·저장소. 확인 못 한 항목은 "미확인"으로 표시했다.
- **범위 밖**: auth, platform, admin, tenant, role/permission, audit, `/internal/*`, push 구독, 메일 계정 관리·OAuth, `/users` 관리자 API, 공개 공유 다운로드.

공백 유형: **[A]** 내용·첨부 읽기 불가 · **[B]** ai-agent 전용(공유 이동 후보) · **[C]** 확인 카드라 외부 미노출 · **[D]** 양쪽 모두 도구 없음
위험 등급: **R** 읽기 · **W** 되돌릴 수 있는 쓰기 · **I** 되돌릴 수 없음 · **N** 다른 사람에게 알림이 감

---

## 2. 전수 조사 결과

### 2-1. 앱별 현황

| 앱 | 외부 MCP 에서 되는 것 | 공백 | 평가 |
|---|---|---|---|
| 이슈 | 목록·상세·생성·수정·코멘트·의존성·워치 | [A] 첨부 텍스트(API 있음) · [D] 커스텀 필드 값 쓰기, 드라이브 링크, 워처 목록, 의존성 그래프 · [C] 삭제 | 가장 충실. 첨부와 일부 필드가 빠짐 |
| 프로젝트 | 목록·상세(유형·라벨·마일스톤·사이클·멤버 이름)·수정 | [C] 생성, 멤버 추가·역할·제거 · [D] 라벨·마일스톤·사이클 생성·수정, 커스텀 필드 정의, 사이클 진행률 | 메타 관리가 안 됨 |
| 노트 | 스페이스·트리·검색·본문·백링크·생성·수정·이동 | [A] 첨부(백엔드 `/text` 없음) · [D] 요약, 판 기록·복원, 멘션, 검색 spaceId | 양호 |
| 드라이브 | 스페이스·목록·검색·내용 검색·요약·휴지통 복원 | [A] 원문 · [B] 폴더 생성·이름 변경·이동, 파일 이동 · [D] 파일 이름 변경, 복사, 버전, 백링크, 첨부 가져오기 | 부족 |
| 메일 | 계정·목록·본문·요약·답장 초안·이슈 초안·이슈 생성·읽음 | [A] 첨부 · [B] 동기화 · [D] 안 읽음 표시, 전체 읽음, category·needsReply 필터 · [C] 발송 | 읽기·AI 는 충분 |
| 메시징 | 채널 목록·메시지·답글·작성·채널 생성·DM·공개 채널 나가기 | [A] 첨부 · [B] 채널 탐색 · [C] 초대, 비공개 채널 나가기 · [D] 참여, 수정·삭제, 리액션, 읽음, 캐치업 요약, 스레드 인박스 | 보내기·읽기만 |
| 캘린더 | 목록·상세·RSVP | [C] 생성·수정·삭제, 참석자 추가·제거 · [D] 캘린더 목록 | **가장 부족** |
| 연락처·구성원 | 구성원 검색·조회, 연락처 목록·조회, 즐겨찾기, 사용자 그룹 | [B] 외부 연락처 생성·수정 · [C] 삭제, 역할·활성 변경 | 양호 |
| 알림 | 목록·읽음·전체 읽음 | 페이지(offset) 미노출 | 양호 |
| 홈 | — | [D] 활동 피드, 우선순위, 메일·메시징 요약(ai-agent 는 화면 표시만 가능, 모델이 내용을 못 읽음) | 공백 |

### 2-2. 첨부·파일 내용 읽기

| 출처 | 백엔드 텍스트 API | 지금 도구 |
|---|---|---|
| 이슈 첨부 | 있음 `IssueAttachmentController.java:73` (`/text`, offset·limit ≤32000) | ai-agent chat 프로필의 `read_attachment_text` 만(채팅 스레드 경유). 외부 MCP·assistant·issue-agent 는 못 읽음 |
| 이슈 챗 첨부 | 있음 | 위와 같음 |
| 홈 채팅 첨부 | 있음 | `read_chat_attachment` (assistant, 세션 바인딩 — 의도된 전용) |
| 노트·메일·메시징 첨부 | **없음** (`/content` 바이너리뿐) | 없음 |
| 드라이브 | **없음** (요약·검색 snippet 만) | `get_drive_file_summary`, `search_drive_content` |

- 공유 도구 핸들러가 `Promise<string>` 만 반환한다(`packages/mcp-tools-shared/src/mcp-tool.ts:33`). 다만 이미지 블록 어댑터(`McpToolResult`, `toMcpContent`)는 WP-240 에서 이미 있어 타입만 넓히면 된다. resource link·structuredContent 는 새로 필요.
- 추출 파이프라인(`FileExtractionRequestedEvent`)은 홈·이슈 챗·이슈 첨부·드라이브 네 곳에서만 걸린다. 드라이브는 추출 텍스트가 이미 있어 API 만 얹으면 되고, 노트·메시징은 추출부터, 메일은 IMAP 에서 그때그때 받아 저장 파일이 없어 접근 방식부터 정해야 한다.
- 이슈·메시지에 연결된 드라이브 파일은 `/{driveFileId}/content` 만 있다(`IssueDriveLinkController:60`, `MessageDriveLinkController:25`).

### 2-3. ai-agent 전용 도구 정리

| 도구 | 판단 |
|---|---|
| `create_folder`, `rename_folder`, `move_folder`, `move_file` (`tools.ts:978-1006`) | 공유로 이동 (W) |
| `create_external_contact`, `update_external_contact` (`:837`, `:848`) | 공유로 이동 (W) |
| `discover_channels` (`:452`) | 공유로 이동 (R) |
| `sync_mail` (`:801`) | 공유로 이동 (W) |
| `update_status` (`:601`) | **폐지** — `IssueService.updateStatus` 가 `update()` 에 위임(`IssueService.java:578-583`)해 권한·이력·알림이 `update_issue` 와 같다. 위험도 중간: v1 담당자 루프 프롬프트(`system-prompt.ts`, `user-message.ts`)와 ai-agent·web 테스트·e2e·inspector 문서를 함께 고친다. 백엔드 `PATCH /status` 는 보드가 쓰므로 유지 |
| `list_project_members` (`:926`) | **폐지** — `get_project.members` 와 같은 뷰. assistant 프롬프트·project-agent 수정 필요 |
| `unassign_self`, `get_chat_thread`, `add_chat_message`, `read_attachment_text`, `read_chat_attachment`, `submit_response`, `show_*` | 에이전트 신원·세션·화면에 묶인 전용 — 유지 |
| `propose_*` 22종(assistant) · 23종(전체, messaging 위임의 `propose_create_issue` 포함) | 2-4 의 노출 기준에 따라 일부를 공유 도구로 전환 |

### 2-4. 노출 기준의 실제 적용

- #853 원칙: "되돌릴 수 없는(destructive) 도구만 PAT 노출에서 뺀다."
- 실제: ai-agent 가 확인 카드(`propose_*` 22종)를 쓰는 작업은 **전부** 공유 패키지 밖에 있어 외부 MCP 에 없다.
- 되돌릴 수 있는데 빠진 것: 일정 생성·수정, 참석자 추가, 프로젝트 생성, 프로젝트 멤버 추가, 채널 초대 (W 또는 W+N)
- 빼는 것이 맞는 것: 메일 발송(I+N), 각종 삭제(I), 구성원 역할·활성 변경(관리자)

### 2-5. 품질 결함

**annotation** (`apps/workplace-mcp/src/mcp/server.ts:25`)
- `readOnlyHint`·`destructiveHint` 만 보내고, write 는 모두 `destructiveHint:false`. 덮어쓰기·제거 도구(`update_issue` 집합 교체, `update_wiki_page` 본문 PUT, `update_project`, `update_user_group`, `edit_comment`, `move_wiki_page`, `rsvp_event`, `remove_*`, `leave_channel`, `unwatch_issue`, `mark_*_read`)가 "추가만 함"으로 잘못 표시된다.
- 고칠 때 `kind` 를 destructive 로 바꾸면 안 된다 — `exposableTools` 가 destructive 를 PAT 노출에서 빼므로 도구가 외부에서 사라진다. hint 는 `kind` 와 별도 필드로 둔다.
- `idempotentHint`·`openWorldHint`·`title` 이 없다(`TOOL_LABELS` 가 이미 있어 title 로 쓸 수 있다).
- ai-agent(`sdk-mcp-server.ts`)는 annotation 을 보내지 않는다.

**페이지네이션**
- 서버 cursor 를 버림: `list_issues`(`rest-client.ts:77`, 서버 기본 30건·상한 100건 — 잘린 줄 모름), `get_channel_messages`(`rest-client.ts:247` — `messaging-tools.ts:79` 주석이 답글에 대해 경고한 문제를 그대로 가짐)
- 페이지 메타를 버림: `list_projects`, `search_members`(`unwrapPage` `rest-client.ts:30`)
- 서버는 지원하나 도구가 안 받음: `list_notifications`(offset)
- 서버부터 없음: `list_drive_items`, `list_wiki_pages`, `list_channels`, `search_wiki`, `search_drive`
- 모범 사례: `list_contacts`(cursor 입출력), `get_thread_replies`(전 페이지 수집 + `truncated`)

**서버 필터 미노출**
- `list_issues`: milestone, parent, 커스텀 필드(서버에 있음). sort 는 서버에도 없고, 워치 중인 이슈는 별도 `/me/watched-issues`
- `list_mail`: category, needsReply (`mark_mail_read` 설명은 "회신 필요"를 언급)
- `search_wiki`: spaceId
- `create_issue`: labels·milestone·cycles 입력 없음 → 생성 후 `update_issue` 를 한 번 더 불러야 함. 서버 `CreateIssueRequest` 에도 필드가 없어 한 번에 저장하려면 백엔드 변경 필요

**응답 크기·식별자 (#833)**
- `get_mail` 이 `bodyText` 와 `bodyHtml` 을 둘 다 반환, `get_issue_detail` 코멘트 무제한, `get_channel_messages` 원문 그대로(리액션·proposal·authorId 포함)
- 숫자 ID 노출: `get_member_contact` 의 userId(`search_members` 설명은 "숫자 userId 아님"), `get_event` 참석자 userId, `ownerId`, 메시지 본문의 `<@123>` 멘션 토큰
- 이름 불일치: 드라이브 폴더가 목록에선 `id`, 휴지통에선 `folderId` · 채널 목록 `id` vs 입력 `channelId` · 이슈 첨부 `fileId` 가 코어 file ID(드라이브는 #840 에서 숨김)
- `parent` 는 이슈 번호, 다른 이슈 참조는 issueKey

**설명·오류**
- `leave_channel` 은 "다시 참여 가능"이라 하지만 join 도구가 없다. `mark_mail_read` 는 되돌릴 도구(unread)가 없다.
- `get_member`·`get_member_contact` 는 못 찾으면 오류 대신 성공 문자열을 돌려준다(`member-tools.ts:99,112`).
- (의도된 동작) `update_issue` 는 version 을 보내지 않는다 — 서버가 AI 도구에선 null(검사 안 함)을 의도한다.
- (의도된 동작) `get_wiki_page` 기본 `base=true` 는 서버에 병합 기준본을 남기고, `update_wiki_page` 가 이것으로 409 없이 병합한다. 끄면 안 된다.

**도구 수**
- ai-agent assistant 프로필이 113개 스키마를 매번 싣는다(공유 63 + 전용 35 + show 15). 라우터는 읽기·show·알림·첨부만 직접 쓰고 나머지는 subagent 몫이다.
- mail-agent 에 `get_project` 가 없어 `create_issue_from_mail` 담당자가 프로젝트 멤버인지 확인할 수 없다.

---

## 3. 경쟁사 비교

### 3-1. 설계 축별 비교

| 서비스 | 파일 내용 | 위험한 작업 | 검색→조회 | 페이지·크기 | 도구 수 관리 |
|---|---|---|---|---|---|
| Atlassian | 단기 다운로드 URL + curl | 실행 도구를 read/write/destructive 로 분리, 삭제는 관리자 기본 Off, plan-then-commit | `search` → get* | `responseFields`, `view` 프리셋 | primary + `discover` + execute 3종, 컨텍스트 50%+ 절감 |
| Notion | 텍스트 200KiB, 바이너리 불가, 만료 URL | 삭제 도구 없음 | search(≤50) → fetch(`truncated` 후 이어 받기) | `has_more`, cursor, `warnings` | 단일 서버 |
| GitHub | text / embedded resource / resource_link | 모든 도구 `ReadOnlyHint` 정적 검사로 강제, read-only 모드 | `search_*` → `*_read` | `fields`, `minimal_output`, `perPage` ≤100 | toolset·readonly·도구 제외(URL/헤더) |
| Google Workspace | **`read_file_content`(텍스트 변환, 이미지·Office 포함)와 `download_file_content`(base64) 분리** | annotation 정확, Gmail 은 초안까지만 | `search_threads`(snippet) → `get_thread` | pageSize ≤50, pageToken | 제품별 서버 |
| Microsoft 365 | 5MB 이하 text/base64 | 통합 서버는 관리자가 켜기 전 읽기 전용, ETag, `transactionId` | KQL → get | `$top`/`$select` | 서버별 허용·차단 |
| Box | `get_file_content`, AI Q&A(1MB), 일회용 URL | 위험 도구 기본 Off(관리자), 삭제 없음 | 검색 → get | limit | 도구별 On/Off |
| Dropbox | `GetMarkdown`(OCR), `GetTranscript`, 5MB 텍스트, 일회용 링크 | 휴지통 삭제 + 복구 도구 | Search → GetFileContent | 100건 단위 | 단일 서버 |
| Slack | Canvas → md, 2단계 업로드 | 초안·미리보기, 수정·삭제 없음 | 검색 → 스레드 | 일부 | 단일 서버 |
| Linear | 3단계 업로드(3자 자료) | 서버 확인 없음 | list/get | limit, cursor | `/mcp/readonly` |

### 3-2. 기능 커버리지 비교

| 기능 | 우리(외부 MCP) | 경쟁사 |
|---|---|---|
| 이슈 첨부 읽기·올리기 | ❌ | Jira(URL), Linear, ClickUp |
| 문서 댓글 | ❌ | Notion, Confluence |
| 드라이브 내용 읽기 | ❌ 요약만 | Google, Dropbox, Box, OneDrive |
| 드라이브 다운로드 링크 | ❌ | Atlassian, Box, Dropbox |
| 드라이브 업로드·생성 | ❌ | Google, Box, Dropbox, OneDrive, Notion |
| 드라이브 이동·이름 변경 | ❌ (ai-agent 만) | Dropbox, OneDrive, Box(기본 Off), Notion |
| 메일 초안 | ✅ | Google(초안만), MS |
| 메일 발송 | ❌ 의도적 | MS, claude.ai Gmail 커넥터. Google 공식 서버는 없음 |
| 채팅 수정 | ❌ | Teams 만 |
| 채팅 리액션 | ❌ | Slack 만 |
| 캘린더 생성·수정 | ❌ | Google, MS |
| 빈 시간 찾기 | ❌ | Google `suggest_time`, MS `findMeetingTimes` |

### 3-3. MCP 스펙·클라이언트 현황 (판단에 쓰인 사실)

- `destructiveHint` 기본값은 true, false 는 "추가만 하는 변경". Claude 는 readOnly 도구를 확인 없이, destructive 도구는 항상 확인을 받아 실행한다. ChatGPT 는 `readOnlyHint` 가 없으면 write 로 보고 확인을 받는다.
- Elicitation: Claude Code·VS Code·Cursor 는 지원. **Claude.ai/Desktop 은 미확인.** 2026-07-28 스펙에서 서버 주도 `elicitation/create` 가 MRTR(`input_required` 반환 → 클라이언트 재시도)로 바뀐다.
- 도구 개수에 대한 스펙 기준은 없다. Claude Code 는 도구 정의가 컨텍스트의 10% 를 넘으면 지연 로드하고, 그때 서버 `instructions`(2,048자)가 도구를 찾는 단서가 된다.
- Claude Code 는 MCP 출력 기본 25k 토큰 상한 — 큰 바이너리를 base64 로 주는 방식은 맞지 않는다.

---

## 4. 개선안

### 4-0. 도구 수 원칙 (먼저 적용)

개선안을 항목마다 새 도구로 만들면 공유 도구가 63개 → 약 110개로 는다(공유 이동 +8, 노출 전환 +7, 첨부 읽기 +5, 앱별 보강 +25~30 — 추정). 경쟁사는 줄이는 추세다(Asana V2 절반 이상 감축, Atlassian 기본 노출 축소로 컨텍스트 50%+ 절감, GitHub 은 100개 넘지만 기본 5개 toolset 만, Notion 약 20개). Claude.ai·ChatGPT 는 도구 정의를 전부 실어 토큰과 선택 정확도에 영향이 있다.

1. **새 도구보다 기존 도구 파라미터 확장을 먼저 검토한다.** 예: `create_issue` 에 라벨·마일스톤·사이클, `update_issue` 에 커스텀 필드 값, 목록 도구에 필터, `get_project` 에 필드 정의·날짜, `mark_mail_read` 에 `read: true/false`.
2. **읽기는 상세 도구에 옵션으로 합친다**(GitHub `issue_read(method=…)` 방식). 예: `get_issue_detail` 에 워처·드라이브 링크, `get_wiki_page` 에 판 기록.
3. **첨부 읽기는 도구 하나로 통일한다**: `read_file(source, …)`(WP-346 당시 이름 `read_attachment`, WP-369 에서 바꿈) — 이슈·노트·메일·메시징 첨부와 드라이브 파일을 같은 도구로 읽는다.
4. **비슷한 쓰기는 묶되 읽기와 쓰기는 섞지 않는다.** 예: 라벨·마일스톤·사이클 생성·수정 → `create_project_meta`·`update_project_meta`(kind 로 구분 — `save_` 같은 새 동사는 쓰지 않는다, §6). 읽기·쓰기를 한 도구에 섞으면 Claude 커넥터 심사에서 반려된다.
5. **외부 MCP 기본 노출은 85개 이하**로 유지한다. 앱별 도구 선택(2-5)을 필수로 둬 사용자가 필요한 앱만 켜게 한다.
   - 2026-10-13 변경(WP-340 웨이브 5, 사용자 결정): 개수 대신 **기본 연결(`/mcp`, destructive 제외)의 도구 정의 크기 ≤ 1.5만 토큰(근사)** + **앱당 15개 이하**로 바꿨다. 클라이언트가 싣는 비용은 개수보다 정의 크기가 정하고, 앱 선택 연결이 실을 양은 앱당 개수가 정하기 때문이다. 근사식·측정 방법은 `packages/mcp-tools-shared/README.md` "도구 수와 정의 크기", 강제는 `tool-naming.test.ts`.
6. **ai-agent 는 공유 도구를 assistant 에 전부 싣지 않는다.** 담당 subagent 에만 주고, assistant 는 읽기·show·위임 도구로 줄인다(2-6).

이 원칙을 적용하면 약 85개로 막을 수 있다(추정). 아래 표는 이 원칙을 반영한 형태다.

각 항목: **근거**(우리 코드) · **선례**(경쟁사) · **위험** · **규모**(S: 1일 이내 / M: 2–4일 / L: 1주 이상). WP-340 범위 번호에 맞췄고, 기반 정비는 0 으로 추가했다.

### 0. 기반 정비 (신규 — 다른 작업의 전제)

| # | 개선안 | 근거 | 선례 | 위험 | 규모 |
|---|---|---|---|---|---|
| 0-1 | **annotation 을 스펙대로** (`kind` 와 별도 필드): 연산 유형별 `destructiveHint`(덮어쓰기·제거는 true), `idempotentHint`, `openWorldHint:false`, `title`(TOOL_LABELS). 모든 공유 도구에 hint 명시를 테스트로 강제 | `server.ts:25` | GitHub `readonlyhint.go` 정적 검사, Google 도구별 hint, Claude 디렉터리 기준 | 없음(정보 정정) | S |
| 0-2 | **공유 도구 반환 타입 확장**: `SharedTool` 을 기존 `McpToolResult`(text·image)로. resource_link·structuredContent 는 필요할 때 | `mcp-tool.ts:33`, WP-240 어댑터 | GitHub `get_file_contents`, 스펙 결과 콘텐츠 | 없음 | S |
| 0-3 | **페이지 복구**: `list_issues`·`get_channel_messages` 에 cursor 입출력, `list_projects`·`search_members` 에 hasMore, `list_notifications` offset. 서버에 페이지가 없는 목록(드라이브·노트 트리·채널·검색)은 limit + `truncated` 표시 | `rest-client.ts:31,77,247` | Notion `has_more`, Google pageToken, 우리 `list_contacts` | 없음 | M |
| 0-4 | **응답 정리**: `get_mail` HTML 제거(형식 선택), `get_channel_messages` 정리 뷰 + 멘션 토큰을 이름으로, 코멘트 개수 제한, 숫자 ID 제거(#833), 드라이브 폴더 `folderId` 로 통일 | 2-5 | GitHub `fields`, Atlassian `view` 프리셋 | 없음(응답 형식 변경 — ai-agent 프롬프트 확인) | M |
| 0-5 | **설명·오류 정비**: `get_member` 계열 오류 반환, `leave_channel`·`mark_mail_read` 설명 정정, 짧은 설명 보강 (`get_wiki_page` base·`update_issue` version 은 의도된 동작이라 제외) | 2-5 | Notion `warnings` | 낮음 | S |

### 1. ai-agent 전용 도구의 공유 이동 (WP-340 범위 1)

| # | 개선안 | 위험 | 규모 |
|---|---|---|---|
| 1-1 | 드라이브 폴더·파일 쓰기 4종 공유 이동 + 이름 변경(`create_drive_folder`·`rename_drive_folder`·`move_drive_folder`·`move_drive_file` — WP-369 에서 `rename_drive_item`·`move_drive_item` 으로 합침), rest-client 메서드 추가 | W | S |
| 1-2 | `create_external_contact`·`update_external_contact`, `discover_channels`, `sync_mail` 공유 이동 | W / R | S |
| 1-3 | `update_status`·`list_project_members` 폐지, 프롬프트·agent.md·테스트 수정 | 중간(v1 담당자 루프 회귀 확인) | M |

선례: GitHub·Notion·Dropbox 모두 이동·이름 변경을 외부에 제공(Box 는 기본 Off).

### 2. 외부 노출 기준 재정리 (WP-340 범위 2)

| # | 개선안 | 근거 | 선례 | 위험 | 규모 |
|---|---|---|---|---|---|
| 2-1 | **기준 문서화**: R·W 는 공유 도구로 노출하고 annotation 으로 클라이언트 확인에 맡긴다. I 는 노출하지 않거나 2-4 의 미리보기→확정 방식으로만. N(알림)은 도구 입력에 알림 수준을 둔다. elicitation 에 의존하지 않는다 | 2-4 | Claude·ChatGPT 의 annotation 기반 확인, MRTR 전환 | — | S |
| 2-2 | **캘린더 쓰기**: `create_event`·`update_event`(알림 수준, 중복 생성 방지 키), `add_attendees`·`remove_attendee` | `propose_create_event` `tools.ts:712` | Google `create_event`(`notificationLevel`), MS `createEvent`(`transactionId`) | W+N | M |
| 2-3 | 프로젝트 생성, 프로젝트 멤버 추가, 채널 초대를 공유 도구로 | `tools.ts:937,955,1096` | Jira·Linear 프로젝트·멤버 도구 | W+N | M |
| 2-4 | (선택) **미리보기→확정**: I 작업은 `preview_*` 가 영향 요약과 확정 id 를 돌려주고 `commit_*`(destructiveHint:true)로 실행. ai-agent `propose_*` 와 서버 로직 공유 | `propose_*` 21종 | Atlassian `updateJiraScreen` plan-then-commit | I | L |
| 2-5 | **앱별 도구 선택과 읽기 전용 모드**(URL·헤더, 필수 — 4-0 원칙 5) | — | GitHub `/readonly`·`X-MCP-Toolsets`, Linear `/mcp/readonly` | 없음 | M |
| 2-6 | **assistant 프로필 축소**: 113개 → 라우터용 읽기·show·위임 도구 + 공유 도구는 담당 subagent 에만 | `tools.ts:1248-1322` | Atlassian 기본 노출 축소, Asana V2 | 낮음(라우팅 회귀 확인) | M |

계속 빼 둘 것: 메일 발송(Google 공식 서버도 초안까지만), 영구 삭제·휴지통 비우기, 외부 공유 링크, 구성원 역할·활성 변경.

### 3. 첨부·파일 내용 읽기 (WP-340 범위 3)

| # | 개선안 | 근거 | 선례 | 위험 | 규모 |
|---|---|---|---|---|---|
| 3-1 | 통합 `read_file(source, …, offset, limit)` 도구 — 1차로 이슈 첨부(`source=issue`, 기존 `/text` API)와 드라이브 파일(`source=drive`, 이슈·메시지에 연결된 드라이브 파일 포함). 이미지는 이미지 블록(0-2) | `IssueAttachmentController.java:72` | Jira 첨부, Google `read_file_content`, Dropbox `GetMarkdown` | R | M |
| 3-2 | 드라이브 추출 텍스트 구간 API(`/drive/files/{id}/text`) — `ExtractedTextService.read` 위에 엔드포인트만. 추출 상태 그대로 반환. 3-1 의 `source=drive` 가 사용 | 드라이브는 업로드 시 이미 추출됨 | 같음 | R | S |
| 3-3 | 노트·메시징 첨부: 업로드 시 추출을 걸고 텍스트 API 추가. 메일 첨부: 저장 파일이 없어(IMAP 재수신) 요청 시 추출 또는 첨부 캐시 연계부터 결정. 이후 `read_file` source 확장 | 추출은 4곳만, 메일은 `MailInboxController:153` | Notion 첨부 다운로드(텍스트), Gmail 첨부 메타 | R | L+ |
| 3-4 | (선택) 단기 서명 **다운로드 링크** — 원본이 필요한 경우(코드 실행 가능한 에이전트) | 공개 공유 다운로드 경로 존재 | Atlassian·Box·Dropbox 일회용 URL | R(링크 유출 시 노출 — 만료·1회용 필수) | M |

원칙: "텍스트로 읽기"와 "원본 받기"를 다른 도구로 둔다(Google·Dropbox 와 같은 구성). base64 원본 반환은 하지 않는다(클라이언트 토큰 상한).

### 4. 앱별 보강 (WP-340 범위 4)

| 앱 | 개선안 | 위험 | 규모 |
|---|---|---|---|
| 드라이브 | `rename_drive_file`(WP-369 에서 `rename_drive_item` 으로 합침), `copy_drive_file`·`copy_drive_folder`, `list_drive_file_backlinks`, `list_drive_file_versions`, 첨부를 드라이브로 가져오기, 폴더 경로(응답 포함 검토) | W / R | M |
| 메시징 | `join_channel`, `add_reaction`·`remove_reaction`, `update_channel_message`(destructiveHint:true), 읽음 처리, `list_channel_members`, 캐치업 요약·스레드 인박스 | W / R | M |
| 이슈 | `create_issue` 에 labels·milestone·cycles(백엔드 `CreateIssueRequest` 변경 또는 후속 호출), `list_issues` 에 milestone·parent(sort 는 백엔드 필요), 워치 중인 이슈(`/me/watched-issues`), `update_issue` 에 커스텀 필드 값, `get_issue_detail` 에 워처·드라이브 링크, 이슈에 드라이브 파일 연결 | W / R | M |
| 프로젝트 | `get_project` 에 커스텀 필드 정의·마일스톤 기한·사이클 기간, 라벨·마일스톤·사이클 생성·수정은 `create_project_meta`·`update_project_meta` | W / R | M |
| 노트 | 페이지 요약, 판 기록 조회(`get_wiki_page` 옵션)·복원, `search_wiki` spaceId | R / W | S |
| 메일 | 안 읽음 표시, `list_mail` category·needsReply, 연결된 이슈 조회(기존 `getMailLinkedIssue` 감싸기) | W / R | S |
| 캘린더 | 캘린더 목록, (후속) 빈 시간 찾기 | R | S / M |
| 홈 | 활동 피드 `/me/activity`, 우선순위 `/me/priority-items`, `/me/mail-summary`·`/me/messaging-summary` 를 읽기 도구로 | R | S |

### 후속 검토 (이번 에픽 밖)

- **통합 `search`/`fetch` + outputSchema**: ChatGPT deep research·company knowledge 와 인용 연동(OpenAI 규약, Notion·Atlassian 이 채택).
- **업로드**: 2단계(업로드 URL 발급 → 완료) — Slack·Linear·Box 방식.
- **관리자 토글**: 워크스페이스 관리자가 기본 Off 인 위험 도구 그룹을 켜는 방식(Atlassian·Box·MS).

---

## 5. AI Chat 연계

공유 도구는 외부 MCP 와 AI Chat(ai-agent)이 함께 쓴다. 외부 MCP 를 고치면 AI Chat 동작도 바뀐다.

- **경로마다 도구 하나**: 같은 작업에 확인 카드(`propose_create_event`)와 직접 실행(`create_event`)이 함께 실리면 모델이 헷갈린다. AI Chat 은 확인 카드를 유지하고, 직접 실행 도구는 외부 MCP 전용으로 두어 assistant·subagent 에 싣지 않는다.
- **검증 로직 공유**: `propose_create_event` 의 참석자 해석(`resolveAttendees`)·시간대 보정(`normalizeTimezone`)·충돌 계산이 `tools.ts` 안에 있다. 외부 MCP 쓰기 도구가 같은 검증을 하려면 공유 패키지(또는 서버)로 옮긴다.
- **첨부 읽기 정리**: AI Chat 에는 이슈 챗 `read_attachment_text`, 홈 `read_chat_attachment`, 원본 사전 다운로드가 따로 있다. `read_file` 과 이름·입력을 맞추고 세션·스레드 바인딩이 꼭 필요한 것만 전용으로 남긴다. opencode 비전 미지원 모델의 이미지 대체(`replaceImagesWithNotice`)가 공유 도구에도 적용되는지 확인한다.
- **subagent 는 도구를 나열한다**: 공유 도구를 추가해도 `agent.md` 의 tools 목록과 라우터 프롬프트에 넣지 않으면 AI Chat 은 못 쓴다. 이슈마다 `agent.md`·프롬프트·라벨(`tool-labels.ts`, 웹 `aiToolLabels`)·`tools.test.ts`·회귀 점검(ai-driven-agent-inspector)을 함께 처리한다.
- **응답 형식 변경**: 필드 이름 통일·페이지 정보 추가는 subagent 식별자 규칙과 이어 조회 안내에 반영한다.
- **annotation**: ai-agent 는 annotation 을 보내지 않는다. 외부 MCP 와 같은 hint 를 실을지 함께 정한다.

## 6. 도구 명명 규칙

파라미터 명명 규칙은 `packages/mcp-tools-shared/README.md` 에 있지만 도구 이름 규칙은 없다. 공유 63개·ai-agent 전용 54개를 보면 대부분 `동사_명사` snake_case 로 일관되나 다음이 어긋난다.

| 문제 | 예 |
|---|---|
| 목록인데 `get_` | `get_channel_messages`, `get_thread_replies`, `get_wiki_backlinks` (나머지는 `list_*`) |
| 수정 동사 혼용 | `edit_comment` vs `update_*` |
| 드라이브 접두 불일치 | 공유는 `list_drive_items`·`restore_drive_item`, ai-agent 는 `move_file`·`create_folder` (`file` 은 첨부, `folder` 는 메일 폴더와 겹침) |
| 같은 종류 다른 동사 | `propose_set_member_role` vs `propose_update_project_member_role` |
| 대상 명사 없음 | `update_status`(폐지 예정), `unassign_self` |

**규칙**
1. `동사_명사[_한정어]`, snake_case, 46자 이내(Anthropic API 64자 − `mcp__genia-works__` 18자).
2. 조회: `list_`(여러 건) · `get_`(한 건) · `search_`(검색어) · `read_`(본문).
3. 쓰기: `create_`/`update_`(독립 리소스) · `add_`/`remove_`(관계·하위 항목). `edit_`·`save_`·`set_` 은 새로 쓰지 않는다.
4. 상태 짝: `mark_*_read`, `watch_`/`unwatch_`, `join_`/`leave_`.
5. 다른 도메인과 겹치는 명사는 도메인 접두: `drive_file`, `drive_folder`, `channel_message`.
6. ai-agent 전용 접두: 확인 카드 `propose_<원 도구명>`, 화면 표시 `show_*`.

**기존 이름 정리**: 클라이언트는 연결 때마다 도구 목록을 새로 받으므로 이름을 바꿔도 평소 사용은 그대로다. 외부 사용자 영향은 도구 이름으로 저장된 "항상 허용" 승인을 한 번 다시 묻는 것과, 사용자가 도구 이름을 직접 적어 둔 드문 경우뿐이다. 그래서 호환용 옛 이름 없이 한 번에 바꾸고 배포 때 공지한다. ai-agent 의 `agent.md`·프롬프트·라벨은 우리 코드이므로 함께 고친다.

## 7. 권장 순서

1. **0-1 annotation 정정** — 지금 운영 클라이언트에 잘못된 위험 정보가 나가고 있어 가장 먼저.
2. **1 공유 이동 + 0-5** — 작은 작업, 외부 MCP 에서 드라이브 정리·연락처 쓰기가 바로 가능해짐.
3. **0-2 반환 타입 + 3-1·3-2 첨부·드라이브 읽기** — 사용자가 처음 지적한 문제.
4. **2-1 기준·명명 규칙 문서화 + 2-2 캘린더 쓰기 + 이름 일괄 정리(§6)** — 가장 부족한 앱, 이름은 도구가 더 늘기 전에.
5. **2-5 앱별 도구 선택 + 2-6 assistant 축소** — 도구가 늘기 전에 노출 범위 장치를 먼저.
6. **0-3·0-4 페이지·응답 정리** — 대량 데이터에서 잘림·토큰 낭비 해소.
7. **4 앱별 보강**(드라이브 → 메시징 → 이슈·프로젝트 → 노트·메일·홈), 3-3 첨부 확장.
8. 선택 항목(2-4, 3-4)과 4장 후속 검토.

## 8. 미확인 사항

- Claude.ai/Desktop 의 elicitation 지원 여부
- Microsoft 통합 Work IQ MCP 도구 목록, Linear·Asana·Slack 의 공식 도구 이름

## 9. 등록 이슈 (WP-340 하위, 사이클 GW-3)

| 개선안 | 이슈 |
|---|---|
| 0-1 annotation | WP-342 (BUG) |
| 1 공유 이동·폐지 | WP-343 |
| 0-5 설명·오류 | WP-344 |
| 0-2 반환 형식 | WP-345 |
| 3-1·3-2 `read_file`(옛 `read_attachment`) | WP-346, WP-369 |
| 2-1 노출 기준·명명 규칙 | WP-347 |
| 2-2 캘린더 쓰기 | WP-348 |
| 2-3 프로젝트·초대 | WP-349 |
| 2-5 앱별 도구 선택 | WP-350 |
| 2-6 assistant 축소 | WP-351 |
| 0-3 페이지 | WP-352 |
| 0-4 응답 정리 | WP-353 |
| 4 드라이브 | WP-354 |
| 4 메시징 | WP-355 |
| 4 이슈·프로젝트 | WP-356 |
| 4 노트·메일·캘린더·홈 | WP-357 |
| 3-3 노트·메일·메시징 첨부 | WP-358 |
| §6 이름 일괄 정리 | WP-360 |

## 부록. 출처

- MCP 명세: https://modelcontextprotocol.io/specification/2025-11-25/server/tools · changelog 2026-07-28 https://modelcontextprotocol.io/specification/2026-07-28/changelog
- Claude 커넥터 기준: https://claude.com/docs/connectors/building/review-criteria · Claude Code MCP: https://code.claude.com/docs/en/mcp
- Atlassian: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/
- Notion: https://developers.notion.com/docs/mcp-supported-tools
- GitHub: https://github.com/github/github-mcp-server
- Google Workspace: https://developers.google.com/workspace/guides/configure-mcp-servers
- Microsoft: https://learn.microsoft.com/microsoft-agent-365/tooling-servers-overview
- Box: https://developer.box.com/guides/box-mcp/tools · Dropbox: https://help.dropbox.com/integrations/connect-dropbox-mcp-server
- Slack: https://docs.slack.dev/ai/mcp-server/ · Linear: https://linear.app/docs/mcp
- OpenAI MCP(search/fetch): https://developers.openai.com/api/docs/mcp/
