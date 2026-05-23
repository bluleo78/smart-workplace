# Phase 3b — 이슈 파일 첨부 설계

> 관련 이슈: bluleo78/smart-workplace#22
> 의존성: Phase 1 (#16), Phase 2 (#17), Phase 3a (#18). file 모듈 (V4)
> 후속: Phase 3c — 다중 assignee 마이그레이션 (#23)

## 1. 목표 / 범위

이슈에 파일을 부착하고 멤버가 다운로드한다. 기존 `file` 모듈을 재사용하고 이슈 도메인 내부에 매핑만 추가한다.

- 원샷 multipart 업로드 — 이슈 엔드포인트로 직접 전송
- 1:N 매핑 (파일은 한 이슈 소속) — `issue_attachment(file_id PK, issue_id, attached_by, attached_at)`
- 다운로드는 기존 `/api/v1/files/{id}/content` 재사용 + 매핑된 file 한정 멤버십 게이트
- 첨부 삭제: 첨부자 또는 프로젝트 OWNER
- 제한: 개별 파일 25MB, 이슈당 최대 10개, MIME 무제한

**Out of Scope**: 인라인 이미지 미리보기, 코멘트 내 첨부, S3 presigned URL, 클립보드 paste 업로드, 첨부 검색.

## 2. 아키텍처

### 2.1 모듈 배치

- 신규 모듈 없음. `issue` 모듈 내부에 `IssueAttachmentService`, `IssueAttachmentRepository`, `IssueAttachmentController`.
- `file` 모듈은 그대로 두되 `FileAccessChecker` 인터페이스(옵셔널 의존)를 받아 매핑된 file 의 멤버십을 위임 검증한다. 구현체 `IssueAttachmentReadGate` 는 issue 모듈에서 Spring Bean 으로 등록 — Modulith 의 file → issue 역방향 의존을 피하면서도 게이트가 동작한다.

### 2.2 데이터 흐름

1. 업로드: 클라이언트 multipart → `IssueAttachmentController.upload(...)` → 멤버 가드 + 한도 검증 → 파일별 `FileUploadService.uploadOne(...)` 위임 → `issue_attachment` row 생성 → `IssueHistoryRecorder.recordAttachmentsChanged(...)` → 응답.
2. 다운로드: 클라이언트 GET `/files/{id}/content` → `FileUploadService.getFileContent(fileId, callerId)` → 등록된 `FileAccessChecker.canRead(fileId, callerId)` 호출 → 매핑된 file 이면 issue 의 프로젝트 멤버 검증 → 통과 시 스트리밍.
3. 삭제: DELETE → 매핑 row 의 `attached_by` 또는 프로젝트 OWNER 검증 → 매핑 row 제거 + `FileUploadService.delete(fileId)` (file row + 디스크 정리) → history 기록.

## 3. 데이터 모델 — Flyway V8

```sql
-- V8__init_issue_attachment.sql
CREATE TABLE issue_attachment (
  file_id      BIGINT PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  issue_id     BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  attached_by  BIGINT NOT NULL REFERENCES "user"(id),
  attached_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_issue_attachment_issue ON issue_attachment(issue_id);
```

ON DELETE CASCADE — 이슈 삭제 시 매핑 자동 정리. file row 의 고아 처리는 `file` 모듈의 cleanup 정책에 위임 (본 페이즈 변경 없음).

## 4. 백엔드 API

### 4.1 업로드 (원샷 multipart)

```
POST /api/v1/projects/{key}/issues/{number}/attachments
Content-Type: multipart/form-data
form fields: files=<file>[, files=<file>, ...]
```

- 권한: 프로젝트 멤버
- 한 요청 최대 10개. 이슈당 누적 10개 초과 시 409 `ATTACHMENT_LIMIT_EXCEEDED`
- 개별 25MB 초과 → 400 `ATTACHMENT_TOO_LARGE`
- 응답:

```json
[
  {
    "fileId": 42,
    "issueId": 7,
    "originalName": "design.png",
    "mimeType": "image/png",
    "sizeBytes": 12345,
    "attachedById": 2,
    "attachedByName": "홍길동",
    "attachedAt": "2026-05-23T10:00:00Z"
  }
]
```

- history: `ATTACHMENTS_CHANGED` 1건 (한 요청 = 한 건). payload toValue JSON:

```json
{ "added": [{ "fileId":42, "originalName":"design.png" }], "removed": [] }
```

### 4.2 목록

```
GET /api/v1/projects/{key}/issues/{number}/attachments
```

- 권한: 멤버
- 정렬: `attached_at DESC`
- 응답: `IssueAttachmentResponse[]` (위 shape)

추가로 `IssueDetailResponse` 에 `attachments: List<IssueAttachmentResponse>` 필드 추가 — 상세 1회 호출로 같이 가져온다.

### 4.3 삭제

```
DELETE /api/v1/projects/{key}/issues/{number}/attachments/{fileId}
```

- 권한: 첨부자 또는 프로젝트 OWNER
- 처리: 매핑 row 의 `(issue_id, file_id)` 일치 확인 → 권한 검증 → 매핑 삭제 + `FileUploadService.delete(fileId)`
- history: `ATTACHMENTS_CHANGED` 1건 (removed)
- 응답: 204

### 4.4 다운로드 (재사용 + 게이트)

기존 `GET /api/v1/files/{fileId}/content` 유지. `FileUploadService.getFileContent(fileId, callerId)` 안에서:

```java
for (FileAccessChecker checker : checkers) {
  if (!checker.canRead(fileId, callerId)) {
    throw new ProjectAccessDeniedException(...);
  }
}
```

`IssueAttachmentReadGate implements FileAccessChecker` — 해당 fileId 가 `issue_attachment` 에 있으면 issue 의 프로젝트 멤버인지 확인. 매핑이 없으면 무관(`true` 반환) — 기존 아바타 등 흐름 영향 없음.

### 4.5 응답에 attachmentCount 추가

`IssueResponse` 에 `attachmentCount: int` 필드 추가. 검색에서 N+1 회피용 batch — `IssueAttachmentRepository.countByIssueIds(List<Long>)` 가 `Map<Long, Integer>` 반환. Phase 3a 의 labels N+1 패턴과 동일.

기존 `IssueResponse.from(...)` 는 0 default. `fromWith(...)` 변형은 라벨 + count 둘 다 받도록 확장 (호환 위해 라벨만 받는 기존 `fromWithLabels(...)` 는 남기되, 검색 경로는 신규 `fromWithDetails(projectKey, row, labels, attachmentCount)` 사용).

### 4.6 에러 매핑

| 상황 | 응답 |
|---|---|
| 25MB 초과 | 400 `ATTACHMENT_TOO_LARGE` |
| 이슈당 10개 초과 | 409 `ATTACHMENT_LIMIT_EXCEEDED` |
| 없는 첨부 | 404 `ATTACHMENT_NOT_FOUND` |
| 비멤버 (업/다/삭) | 403 |
| 첨부자/OWNER 아닌 삭제 | 403 |
| 없는 이슈 | 404 `ISSUE_NOT_FOUND` (기존 매핑) |

### 4.7 Spring multipart 설정

`application.yml`:
```yaml
spring:
  servlet:
    multipart:
      max-file-size: 25MB
      max-request-size: 275MB    # 10 × 25 + 여유
```

`IssueAttachmentService` 안에서 동일 25MB 재검증 (defense in depth).

## 5. 프론트엔드

### 5.1 파일 구조

```
src/types/attachment.ts                                # IssueAttachment 인터페이스
src/api/issueAttachments.ts                            # upload (multipart) / list / delete
src/hooks/queries/useIssueAttachments.ts
src/hooks/queries/useUploadIssueAttachments.ts
src/hooks/queries/useDeleteIssueAttachment.ts
src/pages/projects/components/
  IssueAttachmentList.tsx
  IssueAttachmentItem.tsx
  IssueAttachmentDropzone.tsx
```

### 5.2 이슈 상세 통합

`IssueDetailPage` 우측 메타에 라벨 섹션 아래 첨부 섹션 추가:

```tsx
<section aria-label="첨부">
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium">첨부</span>
    <span className="text-xs text-muted-foreground">{count}/10</span>
  </div>
  <IssueAttachmentDropzone projectKey={key} number={number} disabled={count >= 10} />
  <IssueAttachmentList projectKey={key} number={number} currentUserId={user.id} isOwner={isOwner} />
</section>
```

### 5.3 Dropzone

- HTML5 native DnD — 외부 라이브러리 불필요
- 클릭 시 `<input type="file" multiple>` 트리거
- 클라이언트 사전 검증: 25MB / 10개 초과 → 토스트 + 스킵
- 업로드 중 시각 상태 (스피너 + disabled)
- `FormData` 에 `files` 다중 append → axios POST

### 5.4 List / Item

- 행: MIME 기반 아이콘(image/document/other 3종) + 파일명(클릭→다운로드) + 크기(`16.2 KB`) + 첨부자 + 상대 시간 + 삭제(조건부)
- 다운로드: 기존 `lib/download.ts` 유틸 재사용 — `client.get('/files/{id}/content', { responseType: 'blob' })`
- 삭제 노출 조건: `attachment.attachedById === currentUserId || isOwner`
- 빈 상태: `첨부가 없습니다`

### 5.5 보드/리스트 영향

- 보드 카드: 첨부 0 아니면 `Paperclip` 아이콘 + 개수 작게 표시
- 리스트: 표시 안 함 (정보량 과다)
- `IssueResponse.attachmentCount` 가 source

### 5.6 활동 타임라인

`ATTACHMENTS_CHANGED` 렌더링: `홍길동님이 첨부 추가/제거 — design.png`. `LABELS_CHANGED` 와 동일한 `toValue` JSON 파싱 패턴.

## 6. 테스트

### 6.1 백엔드 (JUnit)

`IssueAttachmentServiceTest`
- 멤버 첨부 1개 OK → 매핑 row + history 1건
- 다중 업로드 (2개) OK → history 1건 (added 2)
- 비멤버 업로드 → 403
- 25MB+1 byte → 400
- 누적 10개 초과 → 409
- 첨부자 본인 삭제 OK (file row + 매핑 정리)
- 다른 멤버 삭제 → 403
- OWNER 가 타인 첨부 삭제 → OK
- 없는 fileId 삭제 → 404

`IssueAttachmentReadGateTest`
- 매핑된 file: 멤버 다운로드 OK, 비멤버 403
- 매핑 없는 file: 종전 흐름 유지 (`canRead == true`)

`IssueSearchServiceAttachmentCountTest`
- 검색 결과 `IssueResponse.attachmentCount` 정확 + N+1 없음

### 6.2 프론트엔드 E2E

`e2e/pages/projects/attachments.spec.ts`
- **@smoke**: 이슈 상세 → 드롭존에 파일 1개 drop → POST multipart 호출 검증 → 목록 추가 → 삭제 클릭 → DELETE 호출 + 목록 제거
- 25MB 초과 → 토스트 + 업로드 미발생
- 10개 한도: 현재 9개 상태에서 2개 시도 → 한도 초과 토스트 (1개만 처리되거나 전부 실패 — UX 결정)
- 비첨부자: 다른 사용자 첨부 행에 삭제 버튼 비노출
- 보드 카드 첨부 아이콘: count > 0 일 때 노출

### 6.3 회귀

- 기존 file 모듈 호출자 (아바타 등): `FileAccessChecker.canRead` 가 매핑 없으면 `true` → 영향 없음
- husky `WEB_DOMAINS_RE='admin|projects|me'` 그대로 — 신규 도메인 없음

## 7. 마이그레이션 영향

- DB: V8 신규 테이블 한 개, 인덱스 한 개
- API: `IssueResponse` JSON 에 `attachmentCount: int` 필드 추가 (default 0). `IssueDetailResponse` 에 `attachments: List<IssueAttachmentResponse>` 추가. 기존 클라이언트는 추가 필드 무시.
- 새 권한 코드 없음 (기존 권한 + 멤버십 가드로 충분)

## 8. 결정 로그

- 매핑: 1:N (`file_id` PK) — 단순성
- 업로드 흐름: 원샷 multipart — UX 단순
- 제한: 개별 25MB, 이슈당 10개, MIME 무제한
- 삭제 권한: 첨부자 + OWNER
- 다운로드 게이트: `FileAccessChecker` 인터페이스 + issue 모듈 구현체 등록 — Modulith 단방향 의존 유지
- 이력: `ATTACHMENTS_CHANGED` 한 요청 = 한 건
- 만료 / 자동 정리: 본 페이즈 범위 밖 (file 모듈 cleanup 정책에 위임)
