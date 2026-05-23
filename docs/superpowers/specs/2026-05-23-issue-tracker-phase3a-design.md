# Phase 3a — 라벨 + Watcher 설계

> 관련 이슈: bluleo78/smart-workplace#18 (epic Phase 3 의 첫 사이클)
> 의존성: Phase 1 (#16), Phase 2 (#17) 머지 완료
> 후속: Phase 3b (파일 첨부), Phase 3c (다중 assignee 마이그레이션) — 별도 사이클로 분리

## 1. 목표 / 범위

이슈 메타데이터 풍부화의 첫 조각. 두 개의 N:M 관계만 추가하고 마이그레이션 부담을 최소화한다.

- **라벨**: 프로젝트 스코프 색상 태그. 사전 정의 12색 팔레트. OWNER 만 CRUD, MEMBER 는 이슈에 부착/제거 가능.
- **Watcher**: 이슈 구독. 사용자가 자기 자신만 토글. reporter / assignee / 코멘트 작성자 자동 등록.
- **검색 필터 확장**: 라벨 다중 선택(AND 결합) — Phase 2 의 `IssueSearchService` 에 파라미터 추가.

**Out of Scope**: 파일 첨부 (3b), 다중 assignee (3c), 라벨 사용자 커스텀 색상, watcher 이벤트 알림(인앱/이메일), 라벨 미부착(`null` 토큰) 필터.

## 2. 용어

UI 표시는 Phase 2 정책 그대로 "태스크"; 코드/DB 식별자는 `issue` 유지. "라벨" 은 한·영 동일하게 사용.

## 3. 아키텍처

### 3.1 백엔드 모듈

- `com.workplace.label` — 신규. 프로젝트 스코프 라벨 CRUD.
- `com.workplace.watcher` — 신규. 이슈 watcher N:M + 자동 등록 유틸.
- `com.workplace.issue` — 기존 모듈에 라벨 매핑 컨트롤러/서비스(`IssueLabelService`) 추가. issue ↔ label 매핑 테이블(`issue_label`) 은 issue 모듈이 소유 (이슈 라이프사이클의 일부).

Spring Modulith 원칙(다른 도메인 패키지 직접 import 금지)을 유지한다. `IssueService` 가 `WatcherAutoEnroller`(watcher 모듈의 public 진입점)를 호출하는 것은 허용된 의존(issue → watcher 단방향).

### 3.2 데이터 흐름

1. **라벨 부착**: 사용자 → `PUT /issues/{n}/labels` (집합 교체) → `IssueLabelService.replace(...)` → diff 계산 후 INSERT/DELETE → `IssueHistoryRecorder` 가 `LABELS_CHANGED` 한 건 기록.
2. **Watch 토글**: 사용자 → `POST/DELETE /issues/{n}/watch` → `WatcherService.toggle(...)` → INSERT ... ON CONFLICT DO NOTHING / DELETE.
3. **자동 watcher**: issue create / comment create / status·assignee 변경 시 서비스가 `WatcherAutoEnroller.enroll(issueId, userId)` 호출 (멱등).

## 4. 데이터 모델 — Flyway V7

```sql
-- 라벨
CREATE TABLE label (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name          VARCHAR(40) NOT NULL,
  color_token   VARCHAR(16) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_label_project ON label(project_id);

-- 이슈 ↔ 라벨
CREATE TABLE issue_label (
  issue_id   BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  label_id   BIGINT NOT NULL REFERENCES label(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX idx_issue_label_label ON issue_label(label_id);

-- 이슈 watcher
CREATE TABLE issue_watcher (
  issue_id   BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX idx_issue_watcher_user ON issue_watcher(user_id);

-- 권한 시드
INSERT INTO permission (code, description) VALUES
  ('label:manage', '프로젝트 라벨 생성/수정/삭제');
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r CROSS JOIN permission p
WHERE r.name='USER' AND p.code='label:manage';
```

`label:manage` 권한 코드는 컨트롤러 `@RequirePermission` 게이트(앱 전역 권한 체크)일 뿐, 프로젝트 단위 OWNER 검증은 `ProjectAccessGuard.assertWithRole(..., "OWNER")` 가 서비스 레이어에서 수행한다 — Phase 1 의 2단계 권한 패턴과 일치.

### 4.1 색상 팔레트 (12색 enum)

`GRAY, RED, ORANGE, YELLOW, GREEN, TEAL, CYAN, BLUE, INDIGO, PURPLE, PINK, BROWN`

화이트리스트 검증은 `LabelService.validateColorToken(...)` 정적 메서드. 잘못된 값 → 400 `INVALID_COLOR_TOKEN`.

## 5. 백엔드 API

### 5.1 라벨 CRUD (OWNER 만 변경)

```
GET    /api/v1/projects/{key}/labels                  # 멤버 — 전체 목록
POST   /api/v1/projects/{key}/labels                  # OWNER — 생성
PATCH  /api/v1/projects/{key}/labels/{labelId}        # OWNER — 이름/색상
DELETE /api/v1/projects/{key}/labels/{labelId}        # OWNER — hard delete (cascade)
```

**Body (POST/PATCH)**
```json
{ "name": "버그", "colorToken": "RED" }
```

- name: 1..40자, 공백 trim, 동일 project_id 내 UNIQUE
- 중복 이름 → 409 `LABEL_NAME_DUPLICATED`
- 잘못된 colorToken → 400 `INVALID_COLOR_TOKEN`

### 5.2 이슈 ↔ 라벨 (멤버)

```
PUT /api/v1/projects/{key}/issues/{number}/labels
Body: { "labelIds": [1, 2, 3] }
Response: 갱신된 LabelSummary 배열
```

- 빈 배열 → 전체 제거
- 다른 프로젝트 라벨 ID 포함 → 400 `INVALID_LABEL_FOR_PROJECT`
- 이력: `LABELS_CHANGED` 1건, payload `{ "added": [...], "removed": [...] }` (LabelSummary 배열을 JSON 문자열로 저장)
- 동시 변경 가드 없음 — last-write-wins

### 5.3 검색 필터 확장

`GET /api/v1/projects/{key}/issues` 에 추가:
```
&label=1,2     # CSV 라벨 ID. AND 결합 (모든 라벨을 가진 이슈)
```

jOOQ 구현: CSV 길이만큼 EXISTS 서브쿼리를 AND 로 누적.
```java
for (Long lid : query.labelIds()) {
  where = where.and(DSL.exists(
    dsl.selectOne().from(ISSUE_LABEL)
       .where(ISSUE_LABEL.ISSUE_ID.eq(ISSUE.ID).and(ISSUE_LABEL.LABEL_ID.eq(lid)))));
}
```

`IssueResponse` 에 `labels: List<LabelSummary>` 추가. N+1 회피: 검색 후 issueId 집합으로 한 번에 `IN` 쿼리 → 메모리 그룹핑.

### 5.4 Watcher

```
GET    /api/v1/projects/{key}/issues/{number}/watchers   # 멤버
POST   /api/v1/projects/{key}/issues/{number}/watch      # 자기 자신 watch (멱등)
DELETE /api/v1/projects/{key}/issues/{number}/watch      # 자기 자신 unwatch (멱등)
GET    /api/v1/me/watched-issues?cursor=&size=           # 내가 watch 중인 이슈 (cursor 페이징)
```

- `me/watched-issues` 응답 모양은 Phase 2 의 `IssueSearchResponse` 와 동일.
- 멤버에서 제외된 프로젝트의 watch 레코드는 DB 에 남지만 `me/watched-issues` 결과에서 멤버십 조건으로 자동 제외.
- POST/DELETE 멱등: ON CONFLICT DO NOTHING / 없는 row 삭제는 200.

### 5.5 자동 watcher 등록 지점

`WatcherAutoEnroller.enroll(issueId, userId)` — 한 줄짜리 멱등 INSERT.

호출:
- `IssueService.create(...)` 끝 — reporter
- `IssueCommentService.create(...)` 끝 — 코멘트 작성자
- `IssueService.update(...)` 안 — 신규 assignee 가 None→Some 또는 다른 사용자로 바뀐 경우
- `IssueService.updateStatus(...)` 는 자동 등록 영향 없음 (assignee 변경 안 됨)

## 6. 프론트엔드

### 6.1 파일 구조

```
src/types/label.ts                          # LabelResponse, LabelSummary, ColorToken
src/api/labels.ts                           # CRUD + 이슈-라벨 PUT
src/api/watchers.ts                         # toggle + /me/watched-issues
src/hooks/queries/useLabels.ts
src/hooks/queries/useUpdateIssueLabels.ts
src/hooks/queries/useWatchToggle.ts
src/hooks/queries/useWatchedIssues.ts
src/lib/labelColors.ts                      # 12색 토큰 → Tailwind 정적 매핑
src/components/labels/
  LabelChip.tsx                             # 색상 + 이름 칩 (재사용)
  LabelPickerPopover.tsx                    # 이슈 상세 부착 픽커
src/pages/projects/components/
  LabelManagement.tsx                       # 설정 페이지 섹션
src/pages/me/
  WatchedIssuesPage.tsx                     # /me/watched
```

### 6.2 라우트

- `/projects/:key/settings` — 기존 페이지에 `LabelManagement` 섹션 추가.
- `/me/watched` — 신규 라우트, `WatchedIssuesPage`. 헤더 네비에 "내 태스크" 메뉴 추가.

### 6.3 라벨 표시 / 부착

- 이슈 상세 우측 메타 영역에 라벨 슬롯: 현재 부착 chip + 편집 버튼 → `LabelPickerPopover` (체크박스 + 검색).
- 팝오버 닫힐 때 `PUT .../labels` 한 번 호출 (diff 가 아닌 전체 집합 교체).
- 리스트 뷰: 제목 셀 아래에 chip 줄바꿈 표시.
- 보드 카드: priority 뱃지 옆 최대 3개 chip + overflow `+N`.

### 6.4 라벨 필터

`IssueFilterBar` 에 라벨 다중 선택 추가 (status/priority 와 같은 toggle-button 그룹 또는 popover).
- URL: `?label=1,2` (CSV). AND 결합.
- `parseFilters` / `filtersToParams` 에 `labelIds: number[]` 추가.
- 라벨 옵션은 프로젝트 라벨 목록(`useLabels`) 에서 가져옴.

### 6.5 Watcher UI

- 이슈 상세 우측 메타: watch 토글 버튼(`Eye` / `EyeOff`) + watcher count.
- 헤더 네비: "내 태스크" → `/me/watched`.
- `/me/watched` 페이지는 Phase 2 `IssueListView` 를 재사용 (props 만 다르게 — `useWatchedIssues` 가 동일 cursor 페이징 shape 반환).

### 6.6 색상 매핑 (Tailwind purge 호환)

정적 객체 — 모든 클래스 문자열이 소스에 명시되어 purge 가 인식하도록.
```ts
export const LABEL_COLORS = {
  GRAY:   { bg: 'bg-slate-200',  text: 'text-slate-800',  dot: 'bg-slate-500'  },
  RED:    { bg: 'bg-red-200',    text: 'text-red-800',    dot: 'bg-red-500'    },
  ORANGE: { bg: 'bg-orange-200', text: 'text-orange-800', dot: 'bg-orange-500' },
  YELLOW: { bg: 'bg-yellow-200', text: 'text-yellow-800', dot: 'bg-yellow-500' },
  GREEN:  { bg: 'bg-green-200',  text: 'text-green-800',  dot: 'bg-green-500'  },
  TEAL:   { bg: 'bg-teal-200',   text: 'text-teal-800',   dot: 'bg-teal-500'   },
  CYAN:   { bg: 'bg-cyan-200',   text: 'text-cyan-800',   dot: 'bg-cyan-500'   },
  BLUE:   { bg: 'bg-blue-200',   text: 'text-blue-800',   dot: 'bg-blue-500'   },
  INDIGO: { bg: 'bg-indigo-200', text: 'text-indigo-800', dot: 'bg-indigo-500' },
  PURPLE: { bg: 'bg-purple-200', text: 'text-purple-800', dot: 'bg-purple-500' },
  PINK:   { bg: 'bg-pink-200',   text: 'text-pink-800',   dot: 'bg-pink-500'   },
  BROWN:  { bg: 'bg-amber-200',  text: 'text-amber-900',  dot: 'bg-amber-700'  },
} as const
```

다크 모드는 별도 variant 키 없이 Tailwind 의 `dark:bg-*-900 dark:text-*-100` 패턴을 chip 컴포넌트가 매핑 (12색 × 두 모드 모두 정적 문자열로 작성).

## 7. 에러 처리

| 상황 | 응답 |
|---|---|
| 라벨 이름 중복 | 409 `LABEL_NAME_DUPLICATED` |
| 라벨 이름 길이/형식 | 400 (Bean Validation) |
| 잘못된 colorToken | 400 `INVALID_COLOR_TOKEN` |
| 라벨 없음 | 404 `LABEL_NOT_FOUND` |
| 다른 프로젝트 라벨 부착 | 400 `INVALID_LABEL_FOR_PROJECT` |
| OWNER 아님 (라벨 CRUD) | 403 |
| 비멤버 라벨/watcher 접근 | 403 |
| 없는 이슈 watch | 404 `ISSUE_NOT_FOUND` |
| 중복 watch/unwatch | 200 (멱등) |

## 8. 테스트

### 8.1 백엔드 (JUnit)

- `LabelServiceTest`
  - OWNER create/update/delete OK
  - MEMBER create → 403
  - 동일 프로젝트 동일 이름 중복 → 409
  - 잘못된 colorToken → 400
  - 다른 프로젝트는 동일 이름 허용
- `IssueLabelServiceTest`
  - 멤버가 라벨 집합 교체 → DB 반영 + history 1건 (LABELS_CHANGED, added/removed JSON)
  - 다른 프로젝트 라벨 섞이면 400
  - 빈 배열 → 전체 제거
- `WatcherServiceTest`
  - 멤버 watch/unwatch OK, 멱등
  - 비멤버 watch → 403
  - 자동 등록: issue create 시 reporter 자동 watcher
  - 자동 등록: comment create 시 작성자 자동 watcher
  - 자동 등록: assignee 변경 시 신규 assignee 자동 watcher
  - 멤버 박탈 후 `me/watched-issues` 자동 숨김
- `IssueSearchServiceTest` 확장
  - `label=1,2` AND 결합
  - 라벨 미부착 + 필터 비활성 시 기존 동작 변동 없음
  - `IssueResponse.labels` 가 N+1 없이 채워짐

### 8.2 프론트엔드 E2E (Playwright)

`e2e/pages/projects/labels.spec.ts`
- **@smoke**: 설정에서 라벨 생성 → 이슈 상세에서 부착 → 리스트 chip 표시 → 필터 적용 → URL `?label=` 반영 → 라벨 삭제 후 사라짐
- MEMBER 권한: 설정 페이지 라벨 편집 UI 미노출, 부착 UI 만 노출
- 인라인 검증: 빈 이름, 41자 초과 → 에러
- 색상 12개 팔레트 표시

`e2e/pages/projects/watch.spec.ts`
- 이슈 상세 watch 토글 → POST → 아이콘/카운트 변경
- 새 이슈 생성 후 watcher 목록에 reporter 자동 포함
- `/me/watched` 진입 → watch 중인 이슈만 노출 + cursor 페이징

### 8.3 회귀 게이팅

- husky `WEB_DOMAINS_RE='admin|projects|me'` 로 확장 — `/me/watched` 도메인 추가.
- 기존 projects 도메인 spec 은 그대로 통과해야 함.

## 9. 마이그레이션 영향

- 기존 `issue.assignee_id` 컬럼/플로우는 변경 없음 (다중 assignee 는 Phase 3c).
- Phase 2 의 `IssueSearchResponse` shape 은 `IssueResponse` 가 `labels` 필드를 추가로 갖게 되어 호환 — 기존 클라이언트가 추가 필드를 무시.
- `IssueHistoryRecorder` 에 새 이벤트 타입 `LABELS_CHANGED` 추가. 기존 활동 타임라인 컴포넌트가 알 수 없는 타입을 만나면 fallback 카피로 표시할 수 있게 보강.

## 10. 결정 로그

- 라벨 색상: 사전 팔레트 12색 (Linear/Notion 스타일) — 디자인 일관성 우선.
- 라벨 CRUD 권한: OWNER 만 — 메타데이터 인플레이션 방지.
- 라벨 부착: 멤버 전원.
- 라벨 필터 결합: AND — Jira/Linear 패턴.
- Watcher 자동 등록: reporter + assignee + 코멘트 작성자.
- Watcher 이벤트 알림: Phase 3a 범위 밖 (별도 notify 모듈).
- 라벨 미부착 필터: Phase 3a 범위 밖 (단순화).
- 다중 assignee / 파일 첨부: Phase 3b·3c 로 분리.
