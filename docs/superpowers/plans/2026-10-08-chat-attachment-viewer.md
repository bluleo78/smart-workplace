# 채팅 3곳 첨부를 뷰어로 연다 (WP-279) — 구현 계획

통합 첨부 뷰어 PR #3. 스펙: `docs/superpowers/specs/2026-10-07-attachment-viewer-design.md` §3.1–3.4, §4, §5.2.

## 사전 확인(백엔드)

- 팀 채팅: `GET /messaging/channels/{c}/messages/{m}/attachments/{f}/content`(`MessageAttachmentController`), `GET /messaging/channels/{c}/messages/{m}/drive-links/{d}/content`(`MessageDriveLinkController`).
- 이슈 채팅: `GET /chat/threads/{t}/messages/{m}/attachments/{f}/content`(`ChatMessageAttachmentController`), `.../drive-links/{d}/content`(`ChatMessageDriveLinkController`).
- 메인 AI 채팅: `GET /home/sessions/{sid}/attachments/{f}/content`(`HomeAttachmentController`).
- 업로드 첨부 가져오기: 메시지·이슈 채팅 첨부 소스 프로바이더가 이미 있어 `useImportAttachment`(core fileId) 그대로 쓴다.
- 형식: 팀 채팅 `MessageAttachmentService/Storage` 는 `mf.getContentType()` 원문 저장(범용·파라미터 가능), 이슈 채팅·홈은 `MimeNormalizer` 정규화 → 업로드 어댑터 공통으로 범용이면 파일명 추론(SVG 추론 없음).
- 백엔드 변경 없음.

## 결정

- **열림 상태 = router state 모드**(`useHistoryParam(key, { mode: 'state' })`, 표면별 고유 키 `teamChatPreview`·`issueChatPreview`·`homeChatPreview`). 뒤로가기 = 뷰어만 닫기(`?thread`·`?chat=1`·AI 시트 유지).
  왜 query 가 아닌가: 채팅 메시지는 무한 스크롤이라 딥링크 키의 메시지가 로드돼 있다는 보장이 없고(찾을 수 없음 오판), 메인 AI 채팅은 모든 라우트 위에 떠 있어 `?preview` 를 쓰면 드라이브·이슈·메일 호스트 네임스페이스에 섞인다. 그래서 `shareable={false}`(링크 복사 없음).
- **묶음 = 클릭한 메시지 한 건의 업로드 + 드라이브 링크(표시 순서)**. 호스트는 클릭 시 받은 묶음을 스냅숏으로 들고, 상태 값(항목 키)이 그 묶음 안에 있을 때만 뷰어를 그린다. 한 번 보여 준 묶음은 값이 사라지면(닫힘) 버린다 → 같은 표면 키를 읽는 다른 인스턴스(스레드 패널의 두 목록·여러 AIChatPanel)가 동시에 뷰어를 그리지 않는다.
- 키: 팀 채팅 `msg:{m}:file:{f}`·`msg:{m}:drive:{d}`, 이슈 채팅 `cmsg:{m}:file:{f}`·`cmsg:{m}:drive:{d}`, 메인 AI `turn:{i}:file:{f}`. 기존 `parseViewerKey`(`^(file|drive):\d+$`)·`isMailViewerKey` 와 겹치지 않음을 vitest 로 고정.
- ✨: 드라이브 링크(ACTIVE)만 — 403/404 면 뷰어가 숨김(`useSummaryAvailability`). ☁: 업로드 첨부만(팀·이슈). 메인 AI 는 둘 다 없음. "드라이브에서 열기"는 ACTIVE 드라이브 링크. 원본으로 이동(sourceLink) 없음 — 이미 그 메시지 안.
- 비활성 링크(TRASHED·DELETED) = `unavailable`.
- 미확정 메시지(id<0)·세션 없는 메인 AI 턴(첫 응답 전)은 콘텐츠 경로가 없어 열지 않는다(썸네일은 그대로 보임).

## Global Constraints

- 백엔드 변경 금지. 기존 뷰어 컴포넌트(AttachmentViewer 등) 동작 변경 금지 — 어댑터·호스트만 추가.
- 썸네일 렌더만으로 SVG·HEIC 원본을 받지 않는 기존 규칙 유지.
- 터치 셸: 탭 = 뷰어, 길게 누르기 = 메시지 작업 시트(목록 위임 long-press 가 발동 뒤 click 을 삼킨다).
- 한국어 주석(무엇·왜) 필수. 커밋 `--no-verify`, 메시지 끝 `(WP-279)`.

## Task 1 — 어댑터·키 + vitest

- `viewerItems.ts`: `attachmentMime(contentType, filename)`(메일 로직 일반화, `mailAttachmentMime` 이 재사용), 드라이브 링크 공통 빌더(이슈 링크 어댑터도 사용), `teamChatAttachmentItem`·`teamChatDriveLinkItem`·`issueChatAttachmentItem`·`issueChatDriveLinkItem`·`homeChatAttachmentItem`, 키 함수.
- `viewerItems.test.ts`: 경로·키·✨/☁/driveOpen 조건·unavailable·범용 형식 추론·SVG 미추론·호스트 간 키 비충돌.

## Task 2 — 공용 채팅 뷰어 호스트 + 카드/썸네일 + 팀 채팅

- `components/chat/ChatAttachmentViewer.tsx`: `ChatAttachmentViewerHost({ historyKey, children })` — 컨텍스트로 `open(items, key)` 제공, 뷰어는 children 의 형제로 그린다(목록 long-press 핸들러로 이벤트가 버블되지 않게). `useStripStaleStateMark`.
- `MessageAttachmentList`: `onDownload*` → `toItem`·`toDriveLinkItem`(없으면 열지 않음), 카드 클릭 = 뷰어. `renderImage(a, onOpen)`.
- `MessageImage`·`ChatMessageImage`·`HomeMessageImage`: `<a target=_blank>` → `<button>`(aria-label `{이름} 미리보기`, testid `attachment-image-open-{fileId}`).
- `MessageList` 를 호스트로 감싸고 `MessageRow` 가 팀 채팅 어댑터를 넘긴다.

## Task 3 — 이슈 채팅·메인 AI 채팅 연결

- `ChatMessageList` 호스트 + `ChatMessageRow` 어댑터.
- `AIChatPanel` 호스트 + 세션 있을 때만 어댑터.

## Task 4 — E2E

- 갱신: `home-chat-attachments.spec.ts` 카드 클릭 = 다운로드 → 뷰어 ⬇.
- 신규 `e2e/pages/chat/chat-attachment-viewer.spec.ts`(chromium): 세 채팅에서 이미지·파일 열기, 묶음 넘김, ⬇, ✨ 노출(링크만·403 숨김), ☁ 업로드만, Esc·뒤로가기 = 뷰어만 닫힘 + 카드 포커스 복귀.
- 신규 `e2e/pages/mobile/chat-attachment-viewer-mobile.spec.ts`: 탭 = 뷰어, 길게 누르기 = 시트, 뒤로가기가 `?thread`·`?chat=1`·AI 시트를 남기는지, 시트 위에서 ‹ › ✕ ⬇ 조작.

## Review Focus

- 단일 뷰어(스레드 패널·채널 목록·여러 AIChatPanel 동시 렌더 없음)와 닫힘 뒤 스냅숏 정리.
- 키 네임스페이스 격리(드라이브·이슈·메일 호스트가 채팅 키를 오인하지 않음 — state 모드라 쿼리에 아예 안 나옴).
- 모바일: 뷰어가 시트·드로워 위 최상단 상호작용 레이어인지, 뒤로가기가 한 겹만 닫는지.
- 범용 형식 추론이 SVG 로 올리지 않는지.
