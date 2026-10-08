# 메일 첨부를 뷰어로 연다 (WP-280) — 구현 계획

통합 첨부 뷰어 PR #4. 스펙: `docs/superpowers/specs/2026-10-07-attachment-viewer-design.md` §3.1–3.4, §4, §5.2.

## 사전 확인(백엔드)

- `GET /mail/attachments/{attachmentId}/content` 존재(`MailInboxController`), 소유 검증 — 타인 첨부는 404.
- DTO `EmailAttachmentMeta { id, filename|null, contentType|null, sizeBytes, contentId|null }` — 뷰어에 필요한 이름·형식·크기가 모두 있다.
- contentType 은 IMAP 경로는 파라미터 제거, Graph 경로는 원문 그대로 저장 → 프런트 어댑터에서 정규화한다.
- 백엔드 변경 없음.

## Global Constraints

- 백엔드 변경 금지. ✨(요약)·☁(가져오기)·참조된 곳·드라이브에서 열기·원본으로 이동 없음 — 필드를 비워 뷰어가 버튼을 숨기게 한다.
- 열림 상태 = URL `?preview=mail:{attachmentId}`(query 모드, 뒤로가기 = 뷰어만 닫기). 메일은 개인 사서함이라 다른 사람은 링크로 못 연다 → `shareable={false}`(⋯ 메뉴 전체가 사라짐).
- 키 `mail:{id}` 는 `file:`(core fileId)·`drive:` 와 다른 네임스페이스. 기존 `parseViewerKey` 는 건드리지 않는다(드라이브·이슈 호스트가 non-null 파싱을 자기 키로 본다).
- 묶음 = 한 메일의 목록 첨부(`inlinedIds` 로 본문 인라인 이미지는 제외된 `listedAttachments`).
- 첨부 목록 렌더만으로는 첨부 콘텐츠를 받지 않는다(기존 "text 본문이면 인라인 조회 0회" 회귀 유지).
- 한국어 주석(무엇·왜) 필수. 각 태스크 커밋은 `--no-verify`, 메시지 끝 `(WP-280)`.

## Task 1 — 메일 첨부 어댑터 + vitest

- `viewerItems.ts`: `mailViewerKey(id)`, `isMailViewerKey(key)`, `mailAttachmentItem(a)`.
  - mimeType: `;` 파라미터 제거·trim·소문자, 비면 `application/octet-stream`.
  - name: `filename || attachment-{id}`(기존 다운로드 파일명 규칙).
  - contentPath = downloadPath = `/mail/attachments/{id}/content`.
- `viewerItems.test.ts`: 키·경로·형식 정규화·null 대체·선택 필드 부재.

## Task 2 — 메일 상세에서 뷰어 열기 + E2E

- `pages/mail/useMailAttachmentViewer.tsx`: `useHistoryParam('preview')` + `useViewerBundle` + 뷰어/찾을 수 없음 노드(`useIssueAttachmentViewer` 패턴).
- `MessageDetailPanel`: 조기 return 전에 훅 호출, ready = 상세 조회 완료(성공·실패). 뷰어 노드는 상세 성공 트리 루트에 한 번.
- `AttachmentList`: 칩 전체를 열기 버튼으로(`mail-attachment-open-{id}`, aria-label `{이름} 미리보기`). 다운로드는 뷰어 ⬇.
- `messageId` 파라미터에 `clear: ['preview']` — 다른 메일로 바꿀 때 낡은 ?preview 가 남지 않게.
- 쓰이지 않게 된 `downloadMailAttachment`·`Download` 아이콘 정리.
- 기존 `mail-inbox.spec.ts` 의 `mail-attachment-download-*` 참조·#180 다운로드 테스트를 뷰어 경유로 갱신.
- 신규 E2E: `e2e/pages/mail/mail-attachment-viewer.spec.ts`(chromium), `e2e/pages/mobile/mail-attachment-viewer-mobile.spec.ts`(mobile)
  - 상세에서 열기(인라인 이미지 제외 → `1 / 2`), 넘김, ⬇ 다운로드 파일명, ✨·☁·⋯ 없음.
  - 모바일: 뒤로가기 = 뷰어만 닫기(`?messageId` 유지), 한 번 더 = 목록. ✕ 도 동일.

## Review Focus

- 뒤로가기 히스토리: 뷰어 닫기가 메일 상세를 닫지 않는지, 메일 전환 시 ?preview 정리.
- 뷰어 노드 위치(인라인 이미지 판정 변화·재조회에 리마운트되지 않는지).
- 콘텐츠 형식 정규화와 octet-stream(미지원 화면 + 다운로드) 동작.
