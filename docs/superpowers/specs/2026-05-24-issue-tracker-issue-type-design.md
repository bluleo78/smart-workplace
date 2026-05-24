# 이슈 유형 (Issue Type) 도입 설계

> 관련 이슈: bluleo78/smart-workplace#27
> 의존성: Phase 1 (#16), Phase 3a 라벨 색상 팔레트 재사용
> 후속: Phase 4a (#24) subtasks — 유형 확정 후 진행

## 1. 목표 / 범위

이슈에 "무엇인가" 분류 메타데이터 도입. status/priority/label 만으로는 부족한 1차 분류 축.

- 시스템 4종 (TASK / BUG / STORY / CHORE) 모든 프로젝트에 자동 시드
- 프로젝트별 CUSTOM 유형 OWNER CRUD (라벨 패턴)
- `issue.type_id NOT NULL` — 모든 이슈는 유형 필수
- 색상 팔레트 12종(라벨과 공유), 아이콘 화이트리스트 8종
- 변경 권한: 멤버 누구나 (이슈 상세 픽커)
- 검색 필터 `type=<id,id>` CSV OR

**Out of Scope**: EPIC 유형 (Phase 4a subtasks 의 parent-child 가 담당), 유형별 status 워크플로우, 유형별 권한, 유형 변경 시 자동 효과 (트리거).

## 2. 아키텍처

신규 모듈 없음. `issue` 모듈 내부에 추가:
- `IssueTypeRepository` / `IssueTypeService` / `IssueTypeController` — 정의 CRUD
- `IssueResponse` 에 `type: IssueTypeSummary` 추가
- `IssueService` 에 `setType(...)` + create 의 typeId 검증/fallback
- `ProjectService.create(...)` 가 시스템 4종 자동 시드 (신규 프로젝트)

색상은 Phase 3a 의 `ColorToken` 12종 화이트리스트 재사용. 아이콘은 신규 `IssueTypeIcon` 8종.

## 3. 데이터 모델 — Flyway V10

```sql
-- V10__issue_type.sql
-- 이슈 유형 정의 (프로젝트별) + 모든 이슈 type_id NOT NULL.

-- 1) 정의 테이블
CREATE TABLE issue_type_def (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name            VARCHAR(40) NOT NULL,
  color_token     VARCHAR(16) NOT NULL,
  icon            VARCHAR(32) NOT NULL,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  position        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_issue_type_def_project ON issue_type_def(project_id);

-- 2) issue.type_id (먼저 nullable 로 추가)
ALTER TABLE issue ADD COLUMN type_id BIGINT REFERENCES issue_type_def(id) ON DELETE RESTRICT;

-- 3) 시스템 4종 시드 — 기존 모든 프로젝트
INSERT INTO issue_type_def (project_id, name, color_token, icon, is_system, position)
SELECT id, 'TASK',  'BLUE',   'Circle',   true, 0 FROM project
UNION ALL SELECT id, 'BUG',   'RED',    'Bug',      true, 1 FROM project
UNION ALL SELECT id, 'STORY', 'PURPLE', 'BookOpen', true, 2 FROM project
UNION ALL SELECT id, 'CHORE', 'GRAY',   'Wrench',   true, 3 FROM project;

-- 4) 기존 이슈 backfill — 각 프로젝트의 TASK 로
UPDATE issue SET type_id = td.id
FROM issue_type_def td
WHERE td.project_id = issue.project_id AND td.name = 'TASK';

-- 5) NOT NULL 확정 + 인덱스
ALTER TABLE issue ALTER COLUMN type_id SET NOT NULL;
CREATE INDEX idx_issue_type ON issue(type_id);
```

**불변식**
- 모든 이슈는 `type_id` NOT NULL
- 같은 프로젝트 내 이름 UNIQUE
- `is_system=true` 행은 수정/삭제 금지 (서비스 가드)
- 사용 중인 CUSTOM 유형 삭제 금지 (FK RESTRICT + 서비스 사전 검증)
- 신규 프로젝트는 `ProjectService.create` 가 시스템 4종 자동 시드

## 4. 백엔드 API

### 4.1 정의 CRUD

```
GET    /api/v1/projects/{key}/types              # 멤버
POST   /api/v1/projects/{key}/types              # OWNER — CUSTOM 생성
PATCH  /api/v1/projects/{key}/types/{typeId}     # OWNER — CUSTOM only
DELETE /api/v1/projects/{key}/types/{typeId}     # OWNER — CUSTOM only
```

**Body (POST/PATCH)**
```json
{ "name": "디자인", "colorToken": "PURPLE", "icon": "Star" }
```

검증:
- name 1..40, project 내 UNIQUE
- colorToken: Phase 3a `ColorToken.validate(...)` (12종)
- icon: `IssueTypeIcon.validate(...)` 8종 (`Circle, Bug, BookOpen, Wrench, Star, Zap, Flag, Target`)

### 4.2 이슈 유형 변경

```
PATCH /api/v1/projects/{key}/issues/{number}/type
{ "typeId": 42 }
→ IssueDetailResponse
```

- 멤버 권한
- typeId 가 같은 프로젝트가 아니면 400 `INVALID_TYPE_FOR_PROJECT`
- history `TYPE_CHANGED` 1건, payload toValue JSON `{from:{id,name}, to:{id,name}}`
- 동일 유형 재요청 → history 미기록

### 4.3 응답 모양

```java
public record IssueTypeSummary(Long id, String name, String colorToken, String icon) {}

public record IssueResponse(
    Long id, String projectKey, int number, String title, String status, String priority,
    LocalDate dueDate, Long reporterId,
    Instant createdAt, Instant updatedAt,
    List<LabelSummary> labels,
    int attachmentCount,
    IssueTypeSummary type,            // 신규 (assignees 직전)
    List<UserSummary> assignees) {}
```

`IssueRow` 에 `typeId: Long` 추가. 모든 select / `insert` / `mapToRow` 갱신.

기존 factory:
- `from(...)`, `fromWithLabels(...)`, `fromWithDetails(...)`, `fromWithFullDetails(...)` — type=null 허용 default 유지
- 실제 사용 경로 (`IssueSearchService.search`, `IssueService.get`, `create`) 는 신규 `fromWithType(...)` 시리즈로 교체. type batch 채움.

### 4.4 IssueService 변경

**create** — `req.typeId()` 가 null 이면 프로젝트의 TASK 로 fallback, 명시되면 같은 프로젝트인지 검증 후 사용.

**setType(callerId, projectKey, number, typeId)** — 멤버 가드 + 같은 프로젝트 검증 + 동일 유형 fast-return + history.

**create/update 의 `IssueRepository.insert/updateAll`** — type 변경 없음. type 변경은 별도 `IssueRepository.updateType(id, newTypeId)`.

### 4.5 IssueSearchService

- `type=<id1>,<id2>` CSV → `IssueRepository.search` 에 `ISSUE.TYPE_ID.in(...)` 조건 추가
- N+1 회피: `IssueTypeRepository.findByIds(typeIds)` → `Map<Long, IssueTypeSummary>` → 검색 결과 batch 채움 (라벨/assignee/attachmentCount 옆)

### 4.6 ProjectService 보강

`ProjectService.create(...)` 끝에 `issueTypeService.seedSystemTypes(project.id())` 호출 — 시스템 4종 INSERT.

V10 은 기존 프로젝트만 시드. 신규 프로젝트는 코드가 일관 처리.

### 4.7 에러 매핑

| 상황 | 응답 |
|---|---|
| 중복 이름 | 409 `TYPE_NAME_DUPLICATED` |
| 시스템 유형 수정/삭제 | 409 `SYSTEM_TYPE_IMMUTABLE` |
| 사용 중 CUSTOM 삭제 | 409 `TYPE_IN_USE` |
| 다른 프로젝트 typeId | 400 `INVALID_TYPE_FOR_PROJECT` |
| 잘못된 icon | 400 `INVALID_TYPE_ICON` |
| 잘못된 colorToken | 400 `INVALID_COLOR_TOKEN` (재사용) |
| OWNER 아님 (CUSTOM CRUD) | 403 |
| 비멤버 | 403 |
| 없는 typeId | 404 `TYPE_NOT_FOUND` |

### 4.8 아이콘 화이트리스트

```java
public final class IssueTypeIcon {
  public static final Set<String> ALL = Set.of(
      "Circle", "Bug", "BookOpen", "Wrench", "Star", "Zap", "Flag", "Target");
  public static String validate(String icon) {
    if (icon == null || !ALL.contains(icon)) throw new InvalidTypeIconException(icon);
    return icon;
  }
}
```

## 5. 프론트엔드

### 5.1 파일 구조

```
src/types/issueType.ts                            # IssueTypeSummary, IssueTypeResponse, ICON_TOKENS
src/lib/issueTypeIcons.ts                         # lucide 아이콘명 → 컴포넌트 매핑 (8종 정적)
src/api/issueTypes.ts                             # CRUD + 이슈 유형 변경
src/hooks/queries/useIssueTypes.ts                # 목록 + CRUD mutations
src/hooks/queries/useUpdateIssueType.ts
src/components/issueTypes/
  IssueTypeBadge.tsx
  IssueTypeSelectPopover.tsx
src/pages/projects/components/
  IssueTypeManagement.tsx
```

### 5.2 IssueTypeBadge

아이콘 + 색상 + 이름. 색상은 Phase 3a `LABEL_COLORS` 재사용. 아이콘은 lucide 컴포넌트 정적 매핑.

```tsx
import * as Icons from 'lucide-react'
import { LABEL_COLORS } from '../../lib/labelColors'
import type { IssueTypeSummary } from '../../types/issueType'

const ICON_MAP: Record<string, typeof Icons.Circle> = {
  Circle: Icons.Circle, Bug: Icons.Bug, BookOpen: Icons.BookOpen, Wrench: Icons.Wrench,
  Star: Icons.Star, Zap: Icons.Zap, Flag: Icons.Flag, Target: Icons.Target,
}

export function IssueTypeBadge({ type, size = 'md' }: { type: IssueTypeSummary; size?: 'sm'|'md' }) {
  const c = LABEL_COLORS[type.colorToken as keyof typeof LABEL_COLORS]
  const Icon = ICON_MAP[type.icon] ?? Icons.Circle
  const padding = size === 'sm' ? 'px-1 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'
  return (
    <span className={`inline-flex items-center gap-1 rounded ${padding} ${c.bg} ${c.text}`}>
      <Icon className="h-3 w-3" /> {type.name}
    </span>
  )
}
```

### 5.3 IssueTypeSelectPopover

라디오 그룹 단일 선택. 항목 클릭 즉시 `useUpdateIssueType.mutate(typeId)` (close 대기 안 함).

trigger 는 현재 유형 뱃지 자체 — 클릭 시 popover 오픈.

### 5.4 IssueTypeManagement (설정 페이지)

- 시스템 4종: 행 표시 + "시스템" 배지 + 편집/삭제 버튼 비활성
- CUSTOM: 인라인 편집 (이름 + 색상 12 dot + 아이콘 8 dot)
- 신규 추가 폼: 이름 + 색상 dot 그룹 + 아이콘 dot 그룹 + "추가"
- 삭제 시 409 → 토스트 "사용 중인 유형은 삭제할 수 없습니다"

### 5.5 IssueCreateDialog

신규 필드: 유형 select (`useIssueTypes(projectKey)` 옵션, default 프로젝트의 TASK).

### 5.6 IssueFilterBar

라벨 필터 옆에 유형 필터 popover. URL `type=1,2`. `parseFilters`/`filtersToParams` 에 `typeIds: number[]` 추가, `searchIssues` 가 `type=` 파라미터 송신.

### 5.7 표시 위치

- 보드 카드: 제목 앞에 아이콘만 (공간 절약)
- 리스트 뷰: 제목 셀 좌측에 배지 (size sm)
- 이슈 상세: 제목 옆 큰 배지 (size md), 클릭 시 픽커 오픈

### 5.8 활동 타임라인

`TYPE_CHANGED` 분기 추가:
```
"홍길동님이 유형을 BUG → STORY 로 변경"
```

## 6. 테스트

### 6.1 백엔드 (JUnit)

`IssueTypeServiceTest`
- OWNER CUSTOM 생성/수정/삭제 OK
- MEMBER 생성 → 403
- 시스템 유형 PATCH/DELETE → 409 `SYSTEM_TYPE_IMMUTABLE`
- 사용 중 CUSTOM 삭제 → 409 `TYPE_IN_USE`
- 중복 이름 → 409
- 잘못된 icon/colorToken → 400

`IssueTypeSystemSeedTest`
- `projectService.create(...)` 후 4종 자동 존재 + is_system=true

`IssueServiceTest` 보강
- create typeId=null → TASK fallback
- create with explicit typeId → 매핑
- create with foreign typeId → 400

`IssueSetTypeTest`
- 멤버 변경 → 200 + history `TYPE_CHANGED`
- 동일 유형 → history 미기록
- 비멤버 → 403
- foreign typeId → 400

`IssueSearchServiceTypesTest`
- `type=<id1>,<id2>` OR 매칭
- 결과 `IssueResponse.type` N+1 없이 정확

### 6.2 V10 마이그레이션 수동 검증

```sql
SELECT project_id, COUNT(*) FROM issue_type_def WHERE is_system GROUP BY project_id;
SELECT COUNT(*) FROM issue WHERE deleted_at IS NULL AND type_id IS NULL; -- 0
SELECT td.name, COUNT(*) FROM issue i JOIN issue_type_def td ON td.id=i.type_id
WHERE i.deleted_at IS NULL GROUP BY td.name;
```

### 6.3 프론트엔드 E2E

`e2e/pages/projects/issue-types.spec.ts`
- **@smoke**: 설정 → CUSTOM "디자인" 추가 (Star+PURPLE) → 이슈 상세에서 디자인 선택 → PATCH 검증 → 배지/카드 변경
- 시스템 유형 행 편집/삭제 비활성
- 사용 중 CUSTOM 삭제 → 409 토스트
- 필터바 type 토글 → URL `?type=` 반영

### 6.4 회귀

- 모든 spec 의 issue factory default 에 `type: { id:1, name:'TASK', colorToken:'BLUE', icon:'Circle' }` 추가
- `IssueResponse` JSON 신규 필드 `type` — 기존 클라이언트 호환 (추가 필드 무시)
- husky 게이팅 변경 없음

## 7. 마이그레이션 영향

- API breaking change 없음 (응답에 신규 필드 추가만)
- `CreateIssueRequest.typeId` optional — 기존 호출자 동작 동일
- `ProjectService.create` 가 시스템 4종 시드 — 신규 프로젝트 자동 적용

## 8. 결정 로그

- 시스템 4종(TASK/BUG/STORY/CHORE) + 프로젝트별 CUSTOM
- EPIC 제외 — Phase 4a subtasks 가 큰 작업 묶기 담당
- 색상: 12종 라벨 팔레트 재사용
- 아이콘: lucide 8종 화이트리스트
- type_id NOT NULL — 모든 이슈 필수 메타
- 변경 권한: 멤버 (status/priority 와 동일)
- CUSTOM CRUD: OWNER (라벨과 동일)
- 시스템 유형 보호: is_system + 서비스 가드 + RESTRICT FK
- 사용 중 CUSTOM 삭제: 409 (서비스 사전 검증)
- 신규 프로젝트 시드: `ProjectService.create` 코드 처리, 기존은 V10 마이그레이션
