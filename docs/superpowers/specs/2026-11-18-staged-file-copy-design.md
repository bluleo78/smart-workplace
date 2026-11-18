# 기존 첨부를 스테이징 파일로 복사·반영 안내 자료 흐름 (WP-1705) — 설계

VOC: WPV-89. 관련: WP-1659(「반영 근거」), WP-1370(이슈 관리자 VOC 처리 지시 — 업무 2).
무인 work-loop 세션이 이슈 본문·사람 댓글(15595)만으로 정한 설계다 — 사람 확인 없이 스스로 승인했다(아래 「내가 정한 것」).

## 의도

AI 이슈 관리자가 VOC(WPV) 반영 댓글에 개발 이슈(WP)의 캡처를 그대로 넣을 수 있게 한다. 이슈 댓글 이미지는
`![설명](file:<fileId>)` 로만 넣을 수 있고 fileId 는 호출자 소유 스테이징 파일만 되는데, 서버 안 AI 는 이미지를 올릴 수 없다.
→ 호출자가 읽을 수 있는 기존 첨부를 **서버에서 복사**해 호출자 소유 스테이징 파일로 만든다(바이트 업로드 없음).
복사본은 새 FILE 행이라, WPV 댓글에 넣으면 WPV 프로젝트의 본문 이미지가 되어 WP 권한 없는 요청자도 본다.

함께, 개발 AI 의 검토 보고에 「사용 가이드」를 더하고(요청자가 따라 할 순서), 보고가 모자랄 때 받는
「VOC 반영 안내」 TASK 를 팀장이 어떻게 처리할지 규칙을 적는다.

## 하지 않는 것

- 노트·채널 메시지·메일 첨부 출처(이슈 본문이 요구한 것은 이슈·이슈 챗·이슈 본문 이미지, 가능하면 드라이브).
- 에이전트 신원 프로필(issue·chat·messaging·home)에 `upload_file` 을 새로 싣기 — 이슈 관리자는 반복 회차(recurring) 프로필로 돌고,
  거기 이미 공유 `upload_file`(content 전용)이 있다. 공유 도구에 출처 복사를 더하면 그대로 실린다.
- 복사본 이름 바꾸기 외의 변환(크기 줄이기 등).

## 방안

| 방안 | 내용 | 판단 |
|---|---|---|
| A. `upload_file` 에 출처 인자 + API `POST /staged-files/copy` | `read_file` 과 같은 모양(source·issueKey·messageId·attachmentId·driveFileId). 서버는 출처 도메인이 구현한 포트로 「읽을 수 있는 core file id」를 받아 스테이징 행으로 복사 | **고름** — 이슈 본문이 제안한 모양, 새 도구가 없어 정의 크기가 적게 늘고 이슈 관리자 프로필이 바로 받는다 |
| B. 새 도구 `copy_file_to_staging` | 도구 하나 더 | 정의 크기 상한(17,700) 여유가 거의 없고, 앱 도구 수 상한도 걸린다 |
| C. 댓글 도구가 다른 이슈 첨부 id 를 바로 받기 | 클레임 경로를 출처별로 넓힘 | 이슈·채팅·드라이브 가드가 이슈 본문 서비스로 새고, 다른 도구(메시지·노트)는 따로 넓혀야 한다 |

## 설계

### API

- `file/api/StagedCopySourceResolver`(포트) — `String source()` 와 `long resolveReadableFileId(long callerId, StagedCopySource src)`.
  `StagedCopySource(source, issueKey, messageId, attachmentId, driveFileId)`. 읽을 수 없거나 없으면 도메인 가드가 던지는 예외 그대로(404/403).
  `AttachmentBindingLookup` 처럼 core(file)가 도메인을 모르고, 도메인이 구현한다.
  - `issue`(issue 모듈): `IssueAttachmentService.resolveFile` 과 같은 가드 — 프로젝트 읽기 + 그 이슈의 첨부 또는 본문 이미지.
  - `issue_chat`(chat 모듈): 이슈 챗 스레드를 찾아 `ChatMessageAttachmentService` 의 가드(메시지에 붙은 파일인지 포함 — 다운로드 경로 `findGuardedStoredFile` 과 같은 조건).
  - `drive`(drive 모듈): `DriveFileService.resolveViewFileId`(공간 VIEWER 이상).
- `StagedUploadService.createFromCopy(callerId, srcFileId)` — 원본 FILE 행의 이름·MIME·크기로 용량 검사, STAGED 경로를 원본 확장자로 만들고
  `FileStore.copy`, 롤백 시 삭제 등록, `insertStagedFile`. 응답은 기존 `StagedFileResponse`.
- `StagedFileController` `POST /api/v1/staged-files/copy` 본문 `{source, issueKey?, messageId?, attachmentId?, driveFileId?}` — source 에 맞는
  리졸버가 없거나 필수 필드가 없으면 400.

### MCP (`packages/mcp-tools-shared`)

- `upload_file` 입력에 `source?: 'issue'|'issue_chat'|'drive'` 와 식별자(`issueKey`·`messageId`·`attachmentId`·`driveFileId`, nullAsOmitted).
  source 별 필수 필드는 `read_file` 의 `SOURCE_FIELDS` 와 같은 규칙(같은 표를 재사용). source 가 있으면 content 와 함께 줄 수 없고 `name` 은 생략 가능(원본 이름).
  source 가 없으면 지금과 같다(`name` 필수).
- content 전용 판(`allowUploadLink: false` — AI Chat·반복 회차)도 source 갈래는 허용한다. 설명은 한 문장(「source 를 주면 읽을 수 있는 첨부를 복사」)만 더한다.
- `FileToolClient.copyToStagedFile(src)` + rest-client 구현. 정의 크기 상한은 올리지 않는다 — 넘치면 큰 설명부터 줄인다. README 「크기」에 새 측정값.

### work-loop 스킬(`plugins/genia-works`)·`.work-loop/project.md`

- `process-issue.md` 8번 「반영 근거」에 **사용 가이드**(요청자가 그대로 따라 할 1·2·3 단계, 사용자 말투; 화면 변화가 없으면 「확인 방법과 결과」가 그 자리)를,
  11번 검토 대기 보고 맨 앞(사용자에게 보이는 변화·확인 위치)에 사용 가이드를 더한다. 기차 7번은 「11번 형식」을 가리키므로 문구만 맞춘다.
- `project.md` 10절 아래에 「안내 자료 요청」 소절 — 라벨 `VOC 반영 안내`. 이 라벨이 붙은 이슈는 분류 대상이 아니다.
- `process-issue.md` 새 절 「안내 자료 요청」(맨 위 갈래가 분류보다 먼저 라벨로 가른다; 라벨 이름은 project.md 에서 읽는다 — 플러그인은 저장소마다 쓴다):
  - 본문이 VOC 키를 적어도 다른 프로젝트 이슈는 열지 않는다. 필요한 내용은 본문에 있다.
  - 워크트리·브랜치·커밋·PR·게이트 없이, MAIN(앞당긴 origin/main)을 `work-loop` 스택으로 띄우거나 운영 검증 테넌트에서 본문이 「모자란 것」으로 적은 항목을 확인한다.
  - 결과는 이 이슈의 검토 대기 보고(REVIEW) — 맨 앞에 바뀐 것·확인 위치·사용 가이드(요청자 말투), 캡처는 `fileIds`(「반영 근거」 형식).
  - 확인 중 기능이 동작하지 않으면 결함 이슈를 만들어(대기열 라벨) 이 이슈에 연결하고, 보고에 그 사실을 적는다.
  - 직접 하기 어려우면(설정이 큰 데이터 준비 등) 개발 대기열 라벨을 붙여 넘기고 담당에서 빠진다 — 받은 AI 도 이 절로 처리한다.
  - 분류 1번 「분류 요청인가」에 「안내 자료 요청 라벨이 붙은 이슈는 아니다」를 더한다.
- 플러그인 버전 0.1.53, `skills.test.mjs` 단언.

## 테스트

- API 통합: 복사 성공(이슈 첨부·본문 이미지·이슈 챗 첨부·드라이브) → 호출자 소유·ATTACHMENT·만료 있음·바이트 같음; 읽을 수 없는 출처(남의 프로젝트·스레드 비멤버·드라이브 비멤버) 404/403 이고 행이 생기지 않음;
  복사본을 다른 프로젝트 댓글에 `file:` 로 넣으면 그 프로젝트만 읽는 사용자가 이미지를 받음(완료 기준 1).
- MCP: upload_file source 갈래(필수 필드·content 와 함께 거절·content 전용 판에서 허용), rest-client, 정의 크기 테스트.
- ai-agent: 반복 회차 프로필 upload_file 이 source 를 받는다.
- 플러그인: skills.test 단언(사용 가이드·안내 자료 요청 절·분류 제외).

## 내가 정한 것

- 방안 A(공유 `upload_file` 출처 인자 + `POST /staged-files/copy`), 출처는 issue·issue_chat·drive.
- 포트 `StagedCopySourceResolver` 를 도메인이 구현(core 가 도메인에 기대지 않게).
- source 갈래의 `name` 은 생략 시 원본 이름, content 와 함께 주면 거절.
- 에이전트 신원 프로필에는 싣지 않음(이슈 관리자는 반복 회차 프로필).
- 안내 자료 요청 라벨 이름은 project.md 에 두고 스킬은 그 절을 읽는다.
