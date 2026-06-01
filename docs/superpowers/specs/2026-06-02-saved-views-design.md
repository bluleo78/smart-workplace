# 저장된 뷰(Saved Views) 설계

> 작성일: 2026-06-02
> 근거 조사: [docs/research/2026-06-01-task-management-nav-survey.md](../../research/2026-06-01-task-management-nav-survey.md) (§4 규칙4 — 저장된 뷰는 성숙한 트래커의 핵심)

## 목표

프로젝트 이슈 목록의 **필터 + 뷰모드(list/board)** 조합을 이름 붙여 저장하고, 프로젝트 페이지 상단 칩 바에서 한 번에 재적용한다. 뷰는 **프로젝트별**이며 **개인(PRIVATE)** 또는 **공유(SHARED)** 가시성을 갖는다.

## 범위

프로젝트 페이지 한정. 개인/공유 뷰 모두 지원. **비범위(YAGNI)**: 그룹핑(group-by, 앱에 미존재) · 기본 뷰 지정 · 뷰 순서 재정렬 · 칩 드래그 · 크로스 프로젝트 개인 뷰.

## 핵심 설계 결정: 필터 저장 방식 = 쿼리스트링 블롭

이슈 필터는 이미 URL 쿼리스트링으로 완전 직렬화된다(`apps/workplace-web/src/lib/issueFilters.ts`의 `filtersToParams`/`parseFilters`, `ProjectDetailPage`가 `useSearchParams`를 단일 진실원으로 사용). 따라서 저장된 뷰의 "필터"는 **`filtersToParams` 결과 쿼리스트링 문자열을 그대로** 저장한다(view 모드 포함).

- 저장: 현재 URL의 쿼리스트링(`?` 제외)을 `query` 컬럼에 TEXT로 저장.
- 적용: `navigate('/projects/{key}?' + view.query)` — 기존 URL 필터 시스템이 그대로 처리.
- 백엔드는 `query`를 **불투명 블롭**으로 저장/반환만 한다(내용 해석은 프론트 관심사). 서버 검증은 길이 제한(예: 2000자)만.

대안(구조화 JSONB)은 백엔드에 필터 스키마를 중복시키고 작업량이 커서 채택하지 않는다.

## 데이터 — `V20__saved_views.sql`

마이그레이션 디렉토리: `apps/workplace-api/src/main/resources/db/migration/` (최신 V19, 다음 V20).

```sql
CREATE TABLE saved_view (
  id         BIGSERIAL    PRIMARY KEY,
  project_id BIGINT       NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  owner_id   BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name       VARCHAR(60)  NOT NULL,
  query      TEXT         NOT NULL,                          -- filtersToParams 결과 쿼리스트링(불투명)
  visibility VARCHAR(8)   NOT NULL DEFAULT 'PRIVATE',        -- PRIVATE | SHARED
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_saved_view_owner_name UNIQUE (project_id, owner_id, name),
  CONSTRAINT ck_saved_view_visibility CHECK (visibility IN ('PRIVATE','SHARED'))
);
CREATE INDEX idx_saved_view_project ON saved_view(project_id);
```

UNIQUE는 (project, owner, name) — 같은 사용자가 한 프로젝트에 동명 뷰를 못 만든다. 다른 사용자의 동명 SHARED 뷰는 허용(소유자별 네임스페이스).

## 백엔드 — 새 `view` 모듈 (label 도메인 미러링)

기존 단순 CRUD 예시 `label`(`V7`, `LabelRow`/`LabelRepository`/`LabelService`/`LabelController`/`CreateLabelRequest`)을 미러링한다.

- **DTO**
  - `SavedViewRow(id, projectId, ownerId, name, query, visibility, createdAt, updatedAt)` — jOOQ row.
  - `SaveViewRequest(name, query, visibility)` — 생성/수정 본문. (Bean Validation: name 1–60, query 1–2000, visibility ∈ {PRIVATE,SHARED}.)
  - `SavedViewResponse(id, name, query, visibility, ownerId, mine)` — `mine`은 호출자가 owner인지(프론트 수정/삭제 메뉴 노출용).
- **`SavedViewRepository`** (jOOQ): `findVisible(projectId, userId)`(= owner=user인 PRIVATE ∪ 프로젝트의 SHARED, 이름순) · `findById(id)` · `insert(projectId, ownerId, name, query, visibility)` · `update(id, name, query, visibility)` · `delete(id)`.
- **`SavedViewService`** + `ProjectAccessGuard`:
  - 목록·생성: `assertMember(projectKey, callerId)`.
  - 수정·삭제: 뷰 owner 본인, **또는** 대상이 SHARED면 프로젝트 OWNER 역할 보유자도 허용(모더레이션). 권한 없으면 403.
  - 뷰가 해당 프로젝트 소속이 아니면 404.
- **`SavedViewController`**:
  - `GET  /api/v1/projects/{key}/saved-views` → `List<SavedViewResponse>`
  - `POST /api/v1/projects/{key}/saved-views` → 생성(201)
  - `PATCH  /api/v1/projects/{key}/saved-views/{id}` → 수정
  - `DELETE /api/v1/projects/{key}/saved-views/{id}` → 204

jOOQ 생성 소스는 커밋 안 함(로컬 `generateJooq`).

## 프론트엔드

- `types/savedView.ts` — `SavedViewResponse`, `Visibility = 'PRIVATE'|'SHARED'`, `SaveViewRequest`.
- `api/savedViews.ts` — list/create/update/remove (axios `client`, `/projects/{key}/saved-views`).
- `hooks/queries/useSavedViews.ts` — `useSavedViews(key)` 목록 + `useCreate/Update/DeleteSavedView` mutation(성공 시 invalidate).
- **`ViewChipBar`** (`src/pages/projects/components/ViewChipBar.tsx`) — ProjectDetailPage 이슈 목록 상단:
  - `[전체]`(쿼리 없는 기본) + 뷰 칩들 + `[＋뷰 저장]`.
  - SHARED 뷰 칩엔 사람 아이콘(`Users`), PRIVATE는 아이콘 없음.
  - 칩 클릭 → `navigate('/projects/{key}?' + view.query)` (현재 필터 교체).
  - **활성 칩** = 현재 `useSearchParams` 직렬화가 그 뷰의 `query`와 일치(정규화 비교: `parseFilters`→`filtersToParams` 라운드트립 후 비교해 키 순서 무시). 일치 없으면 `전체`도 비활성(자유 필터 상태).
  - `＋뷰 저장` → 다이얼로그(이름 + PRIVATE/SHARED) → 현재 URL 쿼리스트링으로 생성.
  - `mine=true` 뷰 칩엔 `⋯` 메뉴(이름/가시성 수정, 삭제).
- 재사용: `lib/issueFilters.ts`(직렬화/정규화), `useSearchParams`(현재 필터).
- 배치: `ProjectDetailPage`의 FilterBar 위. (board/list 어느 뷰든 칩 바는 공통.)

## 데이터 흐름

```
[저장]  현재 URL ?query → ＋뷰 저장(name, visibility) → POST → 목록 invalidate → 칩 등장
[적용]  칩 클릭 → navigate(?view.query) → useSearchParams 갱신 → 이슈 목록·필터바 재구성
[활성]  현재 쿼리 ≡(정규화) view.query → 해당 칩 강조
[수정/삭제]  mine 뷰 ⋯ → PATCH/DELETE → invalidate
```

## 에러 처리

- 생성 시 동명 충돌(UNIQUE) → 409 → 프론트 토스트("같은 이름의 뷰가 있어요").
- 권한 없는 수정/삭제 → 403 → `handleApiError` 토스트.
- 길이 초과 등 검증 실패 → 400 → 필드 에러/토스트.

## 테스트

### JUnit (통합)
- 가시성 격리: 내 PRIVATE는 보이고 타인 PRIVATE는 안 보임; SHARED는 멤버 전체에게 보임.
- 권한: 타인 뷰 수정/삭제 403; SHARED 뷰를 프로젝트 OWNER가 삭제 허용; owner 본인 수정/삭제 허용.
- CRUD + UNIQUE 충돌(409 매핑) + 타 프로젝트 뷰 접근 404.

### E2E (Playwright)
- 필터 적용 → ＋뷰 저장(POST payload의 name·query·visibility 검증) → 칩 등장.
- 다른 필터로 변경 → 칩 클릭 → URL 쿼리·이슈 목록·활성 칩 복원.
- SHARED 뷰가 사람 아이콘과 함께 표시.
- 내 뷰 ⋯ → 삭제 → DELETE 호출 + 칩 제거.
- `전체` 칩 → 쿼리 클리어.
