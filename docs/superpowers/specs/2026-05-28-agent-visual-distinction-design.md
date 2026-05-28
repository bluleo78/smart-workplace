# Phase 5c-3: AGENT 코멘트/타임라인 시각 구분 설계 (#35)

작성일: 2026-05-28
대상 이슈: [#35](https://github.com/bluleo78/smart-workplace/issues/35)
선행: #30 (Phase 5c — closed, 백엔드/agent 측 완료)

## 목표

이슈 상세 페이지에서 **AGENT 가 작성한 코멘트와 활동 이력을 일반 사용자(USER) 와 시각적으로 구분** 한다.
사용자가 한눈에 "이건 AI 가 한 일" 을 인지할 수 있어야 한다.

## 비목표 (Out of Scope)

- AGENT 별 아바타 이미지 (현재 시스템에 사용자 아바타 자체가 없음)
- AGENT 메타데이터 상세 노출 (모델명, 토큰 사용량 등)
- 신규 DB 컬럼 추가 (`user.kind` 는 이미 존재)
- 실시간 푸시/알림
- 코멘트 작성 시점의 AGENT 식별자 외 추가 컨텍스트

## 범위

### 1. 백엔드 (workplace-api) — 응답 DTO 확장

`user.kind` 가 응답에 노출되지 않아 프론트가 구분 불가능 → 두 DTO 에 `kind` 필드를 추가.

- `IssueCommentResponse`
  - 추가 필드: `String authorKind` ("USER" | "AGENT")
  - `IssueCommentRepository.mapToResponse` 에서 `USER.KIND` SELECT 후 매핑
- `IssueHistoryEntryResponse`
  - 추가 필드: `String actorKind` ("USER" | "AGENT")
  - `IssueHistoryRepository.mapToResponse` 에서 동일 처리

JOIN 은 이미 `USER` 테이블에 걸려 있으므로 신규 쿼리 추가 없음. SELECT 컬럼만 늘림.

### 2. 프론트엔드 타입 (workplace-web)

- `src/types/issue.ts`
  - `IssueCommentResponse.authorKind: 'USER' | 'AGENT'` 추가
  - `IssueHistoryEntry.actorKind: 'USER' | 'AGENT'` 추가
- 기존 mock factory (e2e) 가 있다면 기본값 `'USER'` 로 보정해 컴파일 에러 회피

### 3. UI 시각 구분

**공통 원칙**
- 색은 `text-blue-600` / `border-blue-500` 계열로 통일 (USER 와 충분히 구분, 다크모드 대응)
- shadcn `Badge` (이미 설치돼 있으면 재사용, 없으면 단순 `<span>` 으로 대체)
- 텍스트 "AI" 배지 — 이모지 금지 규칙 준수

**`IssueCommentList`**
- AGENT 코멘트 `<li>` 컨테이너:
  - 기존 `border rounded p-3` → AGENT 일 때 `border-blue-500/50 bg-blue-50/40 dark:bg-blue-950/20`
- 작성자 라인:
  - AGENT 일 때 `authorName` 옆에 `<span className="ml-1 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">AI</span>`

**`IssueActivityTimeline`**
- AGENT 행 `<li>`:
  - 기존 `border-l-2 pl-3` → AGENT 일 때 `border-l-blue-500`
- actor 라인:
  - 위와 동일한 "AI" 배지 inline 부착

### 4. E2E 테스트

`apps/workplace-web/e2e/pages/issue-detail` 영역에 케이스 추가 (정확한 파일은 plan 단계에서 확정):

1. **코멘트 시각 구분**
   - mock: 코멘트 2개 (USER 1, AGENT 1)
   - assert: AGENT `<li>` 가 `border-blue-500/50` 클래스 보유, 그 안에 텍스트 "AI" 가 존재
   - assert: USER `<li>` 는 해당 클래스 없음
2. **타임라인 시각 구분**
   - mock: history 2건 (USER actor 1, AGENT actor 1)
   - assert: AGENT 행이 `border-l-blue-500`, "AI" 배지 존재

@smoke 태그는 **부착하지 않는다** — 핵심 happy path 가 아닌 시각 디테일이므로.

## 데이터 흐름

```
DB user.kind ─JOIN─▶ IssueCommentRepository.mapToResponse
                       │
                       ▼
                 IssueCommentResponse(authorKind)
                       │
                       ▼ JSON
                  workplace-web fetch
                       │
                       ▼
                 IssueCommentList → AGENT 분기 스타일링
```

(타임라인도 동일 패턴)

## 백엔드 호환성

- 응답에 필드를 **추가**만 한다 — 기존 클라이언트 파괴 없음
- 기존 통합 테스트(`IssueCommentControllerTest` 등) 는 record 비교 시 새 필드를 채워야 컴파일 오류 발생 → plan 단계에서 명시적으로 보정
- AGENT 사용자의 `kind` 가 `null` 일 가능성: V?? 마이그레이션에서 NOT NULL 인지 확인 필요. 만약 nullable 이라면 응답에서 `null → "USER"` fallback 적용.

## 테스트 전략

- **백엔드**: 기존 `IssueCommentControllerTest` / `IssueHistoryControllerTest` 류에 `authorKind` / `actorKind` 가 노출되는지 assertion 1줄씩 추가 (AGENT 케이스 신규 fixture 1개)
- **프론트**: Playwright E2E 위 2 케이스
- 타입 체크는 `pnpm typecheck` + e2e `tsc -p tsconfig.e2e.json --noEmit`

## 위험/주의

1. **shadcn `Badge`** — 현재 설치 여부 미확인. 미설치 시 plan 단계에서 inline `<span>` 으로 갈지 `npx shadcn add badge` 로 추가할지 결정.
2. **다크모드** — 모든 색상은 `dark:` variant 동반.
3. **AGENT 자신이 자기 자신을 보는 케이스** — 이 페이지를 AGENT 가 직접 열어볼 일은 없지만, 시각 구분이 정상 USER 의 가독성을 해치면 안 됨 (배경 틴트 강도는 `/40` 이하 유지).

## 완료 조건

- [ ] 백엔드 두 DTO 에 kind 노출, 통합 테스트 통과
- [ ] 프론트 타입 + 두 컴포넌트 UI 분기
- [ ] E2E 두 케이스 통과
- [ ] `pnpm lint && pnpm typecheck && pnpm build` 통과
- [ ] 로컬 dev 에서 USER/AGENT 코멘트를 눈으로 비교, 스크린샷 1장
