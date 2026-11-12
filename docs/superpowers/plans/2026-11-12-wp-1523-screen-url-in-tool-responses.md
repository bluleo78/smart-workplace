# WP-1523 도구 응답에 화면 주소(url) 싣기

## 목표

AI 가 이슈 본문·코멘트·노트에 없는 화면 주소(`genia-works.iacloud.kr/issues/WPV-7x` 등)를 지어내지 않게 한다.
도구 응답이 실제 화면 주소(`url`)를 주고, MCP instructions 가 「이슈는 키로, 주소는 도구가 준 url 만」을 규칙으로 알린다.

## 결정

1. **주소는 서버가 만든다.** MCP 는 웹 주소를 모른다. 서버는 `workplace.public-base-url`(운영 `WEB_BASE_URL`)을 이미 안다.
   경로 형식은 서버의 한 곳 `global/util/AppWebLinks` 에만 둔다. 웹 `appUrl.ts`·`driveOpen.ts` 와 같은 모양이고 `appLinks.ts` 가 앱 링크로 읽는다.
   서버 곳곳에서 손으로 만들던 상대 경로도 이 클래스의 정적 메서드로 옮겼다(리뷰 반영). 출력 글자는 그대로다.
   - 옮긴 곳: 알림 푸시, 우선순위 항목, 이슈·채팅 첨부 출처, 이슈·채팅 드라이브 링크 출처, 노트 첨부 출처, 메시징 이슈 제안 결과.
   - 이슈 `/projects/{KEY}/issues/{n}`
   - 노트 `/wiki/spaces/{spaceId}/pages/{id}`
   - 드라이브 파일 `/drive/spaces/{spaceId}?folderId={folderId}&preview={id}`(최상위 파일은 `?preview={id}`)
     - 이슈 본문은 `?file={id}` 라고 적었지만 드라이브 화면은 `file` 을 읽지 않는다. 그래서 웹 `driveFilePath` 의 실제 모양을 따랐다.
     - 드라이브 화면은 미리볼 파일을 「지금 폴더」에서만 찾는다. 그래서 하위 폴더 파일은 `folderId` 가 있어야 열린다.
   - 일정 `/calendar?eventId={id}`: 웹에 이 경로가 있다(`calendarEventPath`). 단건 조회·생성·수정은 늘 실제 일정 행이라 그 id 를 쓴다.
2. **싣는 방식**
   - 이슈·노트·일정은 응답 레코드를 바꾸지 않는다. 컨트롤러가 `WithWebUrl<T>`(`@JsonUnwrapped` 본문 + `url`)로 감싼다.
     JSON 은 기존 필드 그대로이고 `url` 하나만 늘어 웹은 영향이 없다. `IssueResponse` 는 생성 지점이 12곳이라 레코드에 넣지 않는다.
   - 드라이브 파일은 `DriveFileResponse` 에 `url` 을 둔다. 저장소의 단일 매퍼(`toResponse`)가 `space_id` 를 함께 읽어 만든다.
     목록·검색·생성·가져오기·이름 바꾸기가 모두 이 매퍼를 지나므로 한 번에 실린다.
3. **url 이 실리는 응답**
   - 이슈: 상세 GET, 생성 POST, 수정 PATCH(내용·상태·유형·부모).
     MCP update_issue 결과는 내용 수정 응답의 url 을 옮긴다. 내용을 고치지 않은 호출에는 url 이 없다.
   - 노트: `GET /wiki/pages/{id}`, `PUT /wiki/pages/{id}`, `PUT /wiki/pages/{id}/html`, 복원, 만들기(노트·HTML).
     create_wiki_page 는 만든 뒤 PUT 으로 본문을 넣으므로 PUT 응답에도 필요하다.
   - 일정: `GET /calendar/events/{id}`, `POST /calendar/events`, `PATCH /calendar/events/{id}`.
     RSVP·참석자 초대는 본문 없는 응답이라 싣지 않는다.
   - 드라이브: 파일 행 전부. 단 로그인 없는 공개 전송 업로드 응답에서는 뺀다(내부 공간 id).
   - 노트 이동은 싣지 않는다. 응답이 본문 없는 204 이고, 이동해도 같은 공간이라 주소가 그대로다.
   - 다운로드 링크(로그인 없는 일회용 링크)는 MCP 뷰에서 `downloadUrl` 로 이름을 바꿨다(업로드 링크의 `uploadUrl` 과 같은 이유).
     「도구가 준 url 만 쓴다」는 규칙 때문에 본문·메시지에 붙지 않게 하려는 것이다.
4. **목록**
   - 이슈 목록 행에는 싣지 않는다. 키만으로 링크가 되고, 행마다 15토큰가량 더해져 50행이면 750토큰이다.
   - 드라이브 목록에는 싣는다. 파일은 키 같은 다른 참조 수단이 없다.
   - 일정 목록·노트 목록·검색에는 싣지 않는다. 목록 응답을 감싸려면 행마다 래퍼가 필요하고, 단건 조회에서 받을 수 있다.
5. **MCP 뷰**
   - `normalizeIssueDetail` 과 create_issue 결과는 필드를 골라 만든다. 그래서 `url` 을 명시적으로 옮긴다.
   - 노트·일정·드라이브 뷰는 나머지 필드를 그대로 넘기므로 따로 바꾸지 않는다.
6. **instructions**
   - 파일 관례(영어, WP-340)를 따라 이슈 키 줄을 영어로 바꿨다:
     `Issues by key (WP-12; auto-links in issues/comments/chat), people by username. Other links (e.g. wiki): only tool-returned urls, never built. No deletion or mail sending.`
   - 노트는 키를 링크로 바꾸지 않는다. 그래서 자동 링크 범위를 이슈·코멘트·채팅으로 적고, 그 밖에는 도구 url 을 쓰게 했다.
   - 길이는 2,041자였고 상한은 2,048자다. 2,045자로 맞추려고 두 곳을 줄였다.
     - 목록 줄을 같은 뜻으로 줄였다.
     - 메일 안내의 「(no sending)」을 뺐다. 위 줄의 「No ... mail sending」과 겹친다.
7. **도구 설명**(dh.yang 승인으로 상한을 17,400 → 17,550 으로 올림, 2026-11-12)
   - 처음 정의 크기는 17,392토큰(여유 8)이라 넣지 못했다. 승인 뒤 본문을 쓰는 도구 9종 설명 끝에 한 마디씩 붙였다(`link-rule.ts`).
   - 이슈·코멘트·이슈 챗·채널 메시지 7종: `Issue keys auto-link; other links only from tool urls.`
     대상: create_issue, update_issue, add_comment, update_comment, add_issue_chat, add_channel_message, update_channel_message.
   - 노트 2종: `Links only from tool urls (keys do not auto-link).`
     대상: create_wiki_page, update_wiki_page. 노트는 키를 링크로 바꾸지 않는다.
   - 작업 뒤 정의 크기는 17,533토큰이다(상한 17,550).
     다운로드 링크 설명의 `<downloadUrl>` 이 +2, 설명 한 마디가 +139다.

8. **웹 AI Chat(workplace-ai-agent)**
   - 같은 공유 도구를 쓴다: `src/mcp/tools.ts` 의 `buildSharedTools` 와 `createSharedToolClient`. 같은 REST 엔드포인트를 부르므로 응답 `url` 은 그대로 받는다.
   - workplace-mcp instructions 는 받지 않는다. 그래서 같은 규칙을 한국어 한 줄(`WORKPLACE_LINK_RULE`, `system-prompt.ts`)로 두고 아래 프롬프트가 함께 쓴다.
     - 비서(라우터) `assistantSystemPrompt`
     - 이슈 담당 `SYSTEM_PROMPT`, 반복 실행 `RECURRING_RUN_SYSTEM_PROMPT`
     - 이슈 챗 `CHAT_SYSTEM_PROMPT`, 메시징 `MESSAGING_SYSTEM_PROMPT`
     - 하위 에이전트 전부: `loadSubagents` 가 agent.md 본문 끝에 붙인다. claude·opencode 두 경로가 모두 이 함수를 지난다.

## 파일

- api
  - `global/util/AppWebLinks.java`(새), `global/dto/WithWebUrl.java`(새)
  - `IssueController`, `WikiPageController`, `WikiSpaceController`, `CalendarEventController`
  - `DriveFileResponse`, `DriveFileRepository`
  - 손으로 경로를 만들던 서비스 8곳: AppWebLinks 정적 메서드로 옮김
  - 테스트: 응답 url 통합 테스트 `WebUrlInResponsesTest`(AppWebLinks 규칙 포함)
- mcp-tools-shared: `issue-detail.ts`, `issue-tools.ts`(create_issue), 뷰 테스트
- workplace-mcp: `instructions.ts`, `instructions.test.ts`

## Review Focus

- base URL 이 비었거나 끝에 `/` 가 있을 때
  - `CapabilityTokens.normalizeBaseUrl` 로 끝 슬래시를 지운다.
  - 비면 url 을 null 로 두고 JSON 에서 뺀다(`NON_NULL`). 상대 경로는 내보내지 않는다.
- 인코딩이 필요한 키
  - 프로젝트 키는 `[A-Z][A-Z0-9]*` 로 검증된 값이라 인코딩하지 않는다.
    옮겨 온 기존 딥링크와 글자가 같아야 하고, 원본 이슈가 지워진 알림의 null 도 예전처럼 이어 붙는다.
  - id 는 숫자다.
- spaceId
  - 드라이브 파일 행은 늘 space 에 속한다(`drive_file.space_id` NOT NULL). 매퍼의 세 projection 모두 `space_id` 를 읽는다.
  - 업로드 링크 발급 응답은 아직 파일이 없어 url 을 주지 않는다.
- 권한·노출
  - url 은 응답에 이미 있는 id(이슈 키·번호, 노트 spaceId·id, 일정 id)만 쓴다.
  - 드라이브는 새로 spaceId 가 주소에 들어간다. 그 파일을 읽을 수 있는 사람이면 이미 그 공간을 아는 값이다.
  - 공개 전송 업로드 응답(`PublicDriveTransferController`)에서는 url 을 뺀다(`DriveFileResponse.withoutUrl`).
- 목록 토큰 비용: 이슈 목록은 제외, 드라이브 목록은 포함(위 4).
