# Phase 4c — 프로젝트 Custom Fields 설계

> 관련 이슈: bluleo78/smart-workplace#26
> 의존성: Phase 1 (#16), 이슈 유형 (#27)
> Phase 4 시리즈 마지막 사이클

## 1. 목표 / 범위

프로젝트별 custom field 정의 + 이슈별 값 저장. 5 타입(TEXT/NUMBER/DATE/SELECT/MULTI_SELECT). 전부 optional. cascade 삭제. 단일 필드 동등 비교 필터.

- `issue_field_def` (프로젝트별 정의) + `issue_field_value` (이슈별 JSONB 값)
- 정의 CRUD 권한: OWNER (라벨 패턴)
- 값 변경 권한: 멤버
- 필드 type immutable (변경은 새 필드)
- 검색: 단일 필드 동등 비교 (다중 필드 필터 deferred)
- 활동 타임라인: 필드별 한 건씩 기록

**Out of Scope** (스펙 #26)
- 필드별 권한
- 조건부 필수
- 필드 타입 변경 마이그레이션
- 사용자 reference 타입
- 다중 필드 필터 UI
- 보드/리스트 컬럼 표시 (향후 사용자 선택 기능 별도)

## 2. 아키텍처

신규 모듈 없음. `issue` 모듈 내부:
- `IssueFieldDefRepository` / `IssueFieldDefService` / `IssueFieldDefController`
- `IssueFieldValueRepository` / `IssueFieldValueService` / `IssueFieldValueController`
- `FieldType` enum + `FieldTypeValidator` (type/options/value 검증 dispatcher)

## 3. 데이터 모델 — Flyway V13

```sql
-- V13__custom_fields.sql
CREATE TABLE issue_field_def (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name        VARCHAR(40) NOT NULL,
  type        VARCHAR(16) NOT NULL,
  options     JSONB,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_field_def_project ON issue_field_def(project_id);

CREATE TABLE issue_field_value (
  issue_id      BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  field_def_id  BIGINT NOT NULL REFERENCES issue_field_def(id) ON DELETE CASCADE,
  value         JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, field_def_id)
);
CREATE INDEX idx_field_value_def ON issue_field_value(field_def_id);
```

### 값 저장 형식 (JSONB)

| Type | JSONB 모양 | 예 |
|---|---|---|
| TEXT | string | `"hello"` |
| NUMBER | number | `42.5` |
| DATE | string (ISO date) | `"2026-06-01"` |
| SELECT | string | `"option-a"` |
| MULTI_SELECT | array of string | `["a","b"]` |

### 불변식

- 같은 프로젝트 내 이름 UNIQUE
- type 화이트리스트 5종
- SELECT/MULTI_SELECT 는 options 필수 (배열, 1..N, 각 1..40자, UNIQUE)
- TEXT/NUMBER/DATE 는 options NULL
- type immutable (PATCH 변경 시도 → 400)
- 값 검증 (PUT 시점): type/options 매칭, 위반 시 400
- 필드 정의 권한: OWNER
- 값 변경 권한: 멤버
- 필드 삭제: FK CASCADE — 모든 이슈 값 같이 제거

## 4. 백엔드 API

### 4.1 필드 정의 CRUD

```
GET    /api/v1/projects/{key}/fields                 # 멤버
POST   /api/v1/projects/{key}/fields                 # OWNER
PATCH  /api/v1/projects/{key}/fields/{fieldId}       # OWNER — 이름/options/position
DELETE /api/v1/projects/{key}/fields/{fieldId}       # OWNER — cascade
```

**Body (POST)**
```json
{
  "name": "스토리포인트",
  "type": "NUMBER",
  "options": null
}
```

**Body (PATCH)** — type 제외 (변경 금지)
```json
{ "name": "story_points", "options": ["a","b"] }
```

검증:
- name 1..40, project 내 UNIQUE
- type 화이트리스트 5종 (`TEXT|NUMBER|DATE|SELECT|MULTI_SELECT`)
- SELECT/MULTI_SELECT: options 필수, ≥1, 각 1..40, UNIQUE
- TEXT/NUMBER/DATE: options 있으면 400
- PATCH 시 type 변경 → 400 `TYPE_IMMUTABLE`
- 중복 이름 → 409 `FIELD_NAME_DUPLICATED`

### 4.2 이슈 필드 값 PUT (집합 교체)

```
PUT /api/v1/projects/{key}/issues/{number}/fields
{
  "values": [
    { "defId": 12, "value": "hello" },
    { "defId": 13, "value": 42 },
    { "defId": 14, "value": ["a", "b"] }
  ]
}
→ IssueDetailResponse (갱신된 customFields)
```

- 권한: 멤버
- 빈 배열 → 전체 제거
- defId 가 같은 프로젝트가 아니면 400 `INVALID_FIELD_FOR_PROJECT`
- value 검증 (`FieldTypeValidator`):
  - TEXT → string, ≤2000
  - NUMBER → number (정수/실수)
  - DATE → ISO `YYYY-MM-DD`
  - SELECT → string ∈ options
  - MULTI_SELECT → array of string ⊆ options
  - 잘못된 값 → 400 `INVALID_FIELD_VALUE`
- value null → 해당 row 삭제
- history: 변경된 필드마다 `CUSTOM_FIELD_CHANGED` 1건, payload `{defId, name, type, from, to}`. diff 0 미기록.

### 4.3 검색 필터 (단순)

`?fieldId=<id>&fieldValue=<v>` — 한 쌍의 필드 동등 비교. 다중 필드 deferred.

```java
if (query.fieldId() != null && query.fieldValue() != null) {
  where = where.and(DSL.exists(
    dsl.selectOne().from(ISSUE_FIELD_VALUE)
      .where(ISSUE_FIELD_VALUE.ISSUE_ID.eq(ISSUE.ID)
        .and(ISSUE_FIELD_VALUE.FIELD_DEF_ID.eq(query.fieldId()))
        .and(ISSUE_FIELD_VALUE.VALUE.cast(String.class).eq(query.fieldValue())))));
}
```

JSONB 캐스트 비교 — type 별 정확한 매칭은 1차 단순화. 향후 type 별 처리.

### 4.4 응답 모양

```java
public record IssueFieldEntry(
    Long defId, String name, String type,
    com.fasterxml.jackson.databind.JsonNode value) {}

public record IssueResponse(
    /* … Phase 4b 시점 모든 필드 (blockedBy/blocks/blocked 까지) */,
    List<IssueFieldEntry> customFields) {}     // 신규
```

신규 factory `fromWithCustomFields(...)` — 모든 필드. 기존 7 factory (`from`, `fromWithLabels`, `fromWithDetails`, `fromWithFullDetails`, `fromWithType`, `fromWithSubtasks`, `fromWithDeps`) 는 신규 필드 default `List.of()`.

### 4.5 검색 N+1 batch

`IssueFieldValueRepository.findByIssueIds(issueIds)` → `Map<Long, List<IssueFieldEntry>>`. 필드 정의는 한 번에 fetch 후 메모리 join.

`IssueSearchService.search` 의 batch 체인 끝에 추가:
```java
var fieldsByIssue = fieldValueRepository.findByIssueIds(issueIds);
var items = rows.stream()
    .map(r -> IssueResponse.fromWithCustomFields(/* …, */, fieldsByIssue.getOrDefault(r.id(), List.of())))
    .toList();
```

`IssueService.get(...)` 도 동일.

### 4.6 에러 매핑

| 상황 | 응답 |
|---|---|
| 필드 이름 중복 | 409 `FIELD_NAME_DUPLICATED` |
| 잘못된 type | 400 `INVALID_FIELD_TYPE` |
| 잘못된 options | 400 `INVALID_FIELD_OPTIONS` |
| PATCH 의 type 변경 시도 | 400 `TYPE_IMMUTABLE` |
| 다른 프로젝트 defId | 400 `INVALID_FIELD_FOR_PROJECT` |
| 잘못된 값 (type/options 미스매치) | 400 `INVALID_FIELD_VALUE` |
| 필드 없음 | 404 `FIELD_NOT_FOUND` |
| OWNER 아님 (CRUD) | 403 |
| 비멤버 | 403 |

## 5. 프론트엔드

### 5.1 파일 구조

```
src/types/customField.ts                          # FieldType, IssueFieldDef, IssueFieldEntry, *Response
src/api/customFields.ts                           # def CRUD + value PUT
src/hooks/queries/useCustomFields.ts              # def 목록 + CRUD mutations
src/hooks/queries/useUpdateIssueFields.ts         # value PUT mutation
src/components/customFields/
  CustomFieldEditor.tsx                           # type 별 위젯 dispatcher
  FieldTextInput.tsx / FieldNumberInput.tsx / FieldDateInput.tsx
  FieldSelect.tsx / FieldMultiSelect.tsx
src/pages/projects/components/
  CustomFieldManagement.tsx                       # 설정 OWNER 편집
  CustomFieldsSection.tsx                         # 이슈 상세 인라인 편집
```

### 5.2 CustomFieldManagement (설정)

OWNER 만 편집. 라벨/이슈유형 관리 옆 섹션.
- 행: name + type 배지 + options preview + 편집/삭제
- 신규 폼: name + type select + (SELECT 류면) options 입력 (콤마 또는 줄바꿈)
- 삭제 confirm: `이 필드는 N개 이슈에서 사용 중입니다. 함께 삭제됩니다. 진행하시겠습니까?` (count 는 응답 부가 필드 또는 별도 API)

### 5.3 CustomFieldsSection (이슈 상세)

이슈 정의 + 값 머지하여 표시:
- 정의된 모든 필드를 type 위젯으로 렌더 (값 없으면 placeholder)
- 변경 시 debounce 300ms 후 PUT (현재 전체 set 머지)
- mutation 응답으로 customFields 새로 받음

### 5.4 위젯 (CustomFieldEditor dispatcher)

| Type | 위젯 |
|---|---|
| TEXT | `<Input>` (debounce) |
| NUMBER | `<Input type="number">` |
| DATE | `<Input type="date">` |
| SELECT | shadcn Select 또는 native `<select>` |
| MULTI_SELECT | 체크박스 popover (라벨 picker 패턴) |

null 값은 placeholder. 빈값으로 변경 시 PUT value=null → 백엔드 row 삭제.

### 5.5 보드 카드 / 리스트

표시 안 함 (정보 과다). 향후 사용자 선택 표시 기능 별도.

### 5.6 활동 타임라인

`CUSTOM_FIELD_CHANGED` 분기:
- `홍길동님이 스토리포인트: 3 → 5`
- `홍길동님이 우선도: → high` (이전 값 null)
- `홍길동님이 메모: hello → (삭제)`

`formatCustomFieldChanged(toValue)` — payload `{defId, name, type, from, to}` 파싱.

### 5.7 카피

- 섹션 헤더: `커스텀 필드`
- 설정 헤더: `프로젝트 필드`
- 토스트: `필드를 추가/수정/삭제했습니다`, `필드 값을 저장했습니다`
- 에러 fallback: `필드 변경에 실패했습니다`

## 6. 테스트

### 6.1 백엔드 (JUnit)

`IssueFieldDefServiceTest`
- OWNER 가 5 타입 각각 create OK
- MEMBER create → 403
- SELECT 인데 options 누락/빈 배열/중복 → 400
- TEXT/NUMBER/DATE 에 options 지정 → 400
- PATCH 시 type 변경 → 400 `TYPE_IMMUTABLE`
- 중복 이름 → 409
- 잘못된 type → 400
- 삭제 → cascade

`IssueFieldValueServiceTest`
- 빈 → 3 PUT OK + history 3건
- 같은 set 재PUT → history 미기록
- null value → row 삭제 + history removed
- 다른 프로젝트 defId → 400
- SELECT options 외 값 → 400
- TEXT 에 number 보냄 → 400
- NUMBER 에 string 보냄 → 400
- MULTI_SELECT 부분집합 OK / 외부 값 → 400

`IssueSearchServiceFieldFilterTest`
- 시드: 이슈 3, 그 중 2개에 NUMBER=5
- `?fieldId=&fieldValue=5` → 2개
- `IssueResponse.customFields` N+1 없이 채워짐

### 6.2 V13 검증 (수동)

```sql
\d issue_field_def
\d issue_field_value
```

### 6.3 프론트엔드 E2E

`e2e/pages/projects/custom-fields.spec.ts`
- **@smoke**: 설정 → NUMBER 필드 추가 → 이슈 상세 값 5 입력 → PUT payload 검증 → 표시 갱신 → 값 8 로 변경 → PUT → 설정에서 필드 삭제 → 이슈 상세에서 사라짐
- SELECT 필드 옵션 외 값 차단 (positive — UI 옵션 화이트리스트)
- MEMBER: 설정 편집 UI 비노출, 이슈 값 편집 가능

### 6.4 회귀

- IssueResponse 신규 `customFields` 호환 (기존 클라이언트 무시)
- factory default `customFields: []`
- husky 그대로

## 7. 결정 로그

- 5 타입 (TEXT/NUMBER/DATE/SELECT/MULTI_SELECT)
- 정의 권한: OWNER
- 값 권한: 멤버
- 전부 optional
- 필드 삭제: cascade + confirm
- type immutable
- 검색: 단일 필드 동등 비교만
- 보드/리스트 표시 X
- 활동 타임라인: 필드별 한 건씩
- options 검증: ≥1, 각 ≤40, UNIQUE
