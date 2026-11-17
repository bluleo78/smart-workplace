# 개인 보고 — 템플릿 분리·저장 위치 고르기 Implementation Plan (WP-1655)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 노트 개인 보고의 템플릿을 「템플릿」 아래로 나눠 id 로 따라가고, 새 보고의 저장 위치를 사용자가 고르게 한다.

**Architecture:** WP-1654(프로젝트 정기 리포트, 커밋 ccb3392b9·417612e42)의 구조를 개인 판으로 본뜬다 — `PersonalReportLocation`(새)이 저장 위치를 해석·검증하고, `PersonalReportTemplate` 은 id 로 템플릿을 찾아 「템플릿」 아래에 복사·옛 위치 이전을 하며, 웹은 공용 `ReportLocationDialog` 를 조금 일반화해 설정 창에서 쓴다. 공간 무관한 `WikiSystemPageWriter` 도우미(`ensureTemplatesPage`·`findTemplatesPage`·`existsInSpace`·`pathTitles`·`isUnderOrSelf`·`renameTo`·`lockSpaceTree`)와 `ReportPageWriter.writeAndMarkInPlace` 는 그대로 쓴다.

**Tech Stack:** Spring Boot + jOOQ(`DSL.name` 주소) + Flyway / React 19 + TanStack Query + vitest(MSW).

**Spec:** `docs/superpowers/specs/2026-11-17-personal-report-location-design.md`

## Global Constraints

- 셸 명령은 단순하게: 한 줄 함수 정의·`${…:-{…}}`·`;`/`&&` 로 길게 이은 한 줄 금지(복잡하면 스크립트 파일). 포트 6060/6070/6080/6090/6095/6173/6174/5434 를 쓰거나 끄지 않는다. `pnpm dev`·`db:*`·`--no-verify` 금지. 하위 에이전트를 띄우지 않는다.
- 한국어 주석 필수(클래스·메서드·주요 로직에 무엇을·왜). 백엔드 포맷은 `./gradlew spotlessApply`.
- 마이그레이션 번호 **V298**(origin/main 최신 V296). 열 추가만(expand). 머지된 마이그레이션은 고치지 않는다.
- 템플릿 페이지 제목: 일일 `일일 보고`, 주간·월간 `주간·월간 보고`. 부모: 내 노트 최상위 `템플릿`(프로젝트 공간의 것과 별개, 공간마다 하나 — `WikiSystemPageWriter.ensureTemplatesPage(spaceId, author)`).
- 기본 저장 위치: 내 노트 최상위 `보고`(`WikiSystemPageWriter.PERSONAL_REPORTS_TITLE`). 고른 위치가 유효하면 「보고」를 만들지 않는다.
- 달 폴더 제목 규칙: `^(\d{4})년 (\d{1,2})월$` 이고 월 1–12(서버·웹 같은 규칙).
- 400 문구(서버, `IllegalArgumentException`): `내 노트의 페이지만 고를 수 있어요.` / `템플릿 아래에는 보고를 둘 수 없어요.` / `AI 가 쓴 보고 페이지 아래에는 둘 수 없어요.` / `달 폴더 아래에는 보고를 둘 수 없어요.`
- 웹 문구: 설정 행 `일일 템플릿`·`주간·월간 템플릿`(설명 `필요할 때 만들기`), 링크 기본 `템플릿 › 일일 보고`·`템플릿 › 주간·월간 보고`, `저장 위치` 행 `내 노트 › {경로 › 로 이음}` + 버튼 `바꾸기`, 고르기 창 제목 `보고 저장 위치`, 설명 `새 보고를 고른 페이지 아래에 달별로 모아 만들어요. 이미 만든 보고는 그대로 둬요.`, 빈 안내 `고를 페이지가 없으면 다음 보고 때 「보고」를 만들어요.`, 저장 성공 토스트 `저장 위치를 바꿨어요`, 다시 만듦 알림 `템플릿을 다시 만들었어요`, 도움말 id `me.reports.location`.
- 쓰기 요청은 검사(400) 먼저, 부수효과(알림 지우기·옛 템플릿 옮기기·저장) 나중.
- 본문 쓰기(동기화 서버 위임)는 트랜잭션 밖. 페이지 만들기·옮기기·제목 바꾸기는 공간 트리 잠금(`lockSpaceTree`) 아래 짧은 트랜잭션.

## Review Focus

1. 고른 위치가 있는 사용자가 보고를 만들면 「보고」가 새로 생기지 않는다 — Task 4 `generate_chosenLocation_doesNotCreateReportsHome`.
2. 저장 위치를 바꾼 뒤 대기 중(앞선 시도가 만든) 페이지를 다시 쓰면 그 페이지는 옛 자리에 남는다 — Task 4 `generate_retryAfterLocationChange_keepsPendingPageInPlace`.
3. 처음 켤 때 두 템플릿을 만들어도 「다시 만들었어요」가 뜨지 않는다(일일을 만든 직후 주간을 「다시 만듦」으로 보지 않음) — Task 2 `ensureBoth_firstEnable_noRecreatedNotice`.
4. 거절된 위치 저장(400)은 옛 템플릿 이동·알림 지우기를 하지 않는다 — Task 3 `updateLocation_rejected_hasNoSideEffects`.
5. 고르기 창이 숨기는 것과 서버가 거절하는 것이 같다(달 폴더 아래 사람 페이지 포함) — Task 1 `validateChoice_underMonthFolder_rejected` + Task 5 `달 폴더와 그 아래를 뺀다`.

---

### Task 1: 스키마·설정 저장소·저장 위치 해석기

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V298__personal_report_location.sql`
- Regenerate (commit): `apps/workplace-api/src/main/generated/**` (`./gradlew generateJooq`)
- Create: `apps/workplace-api/src/main/java/com/workplace/wiki/report/PersonalReportMonthFolder.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/wiki/report/PersonalReportLocation.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/report/PersonalReportSettingRepository.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/service/WikiSystemPageWriter.java` (개인 공간·「보고」 찾기/보장 나누기)
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/report/PersonalReportGenerator.java` (`MONTH_FOLDER`·`parseMonthFolder` 를 새 클래스로 옮기고 호출만 바꿈)
- Test: `apps/workplace-api/src/test/java/com/workplace/wiki/report/PersonalReportSettingRepositoryTest.java`, Create `.../PersonalReportLocationTest.java`

**Interfaces:**
- Produces:
  - SQL: `ALTER TABLE personal_report_setting ADD COLUMN report_location_page_id BIGINT REFERENCES wiki_page(id) ON DELETE SET NULL, ADD COLUMN template_initialized BOOLEAN NOT NULL DEFAULT false, ADD COLUMN daily_template_made BOOLEAN NOT NULL DEFAULT false, ADD COLUMN weekly_template_made BOOLEAN NOT NULL DEFAULT false, ADD COLUMN template_recreated_at TIMESTAMPTZ;` + `CREATE INDEX idx_personal_report_setting_location ON personal_report_setting(report_location_page_id);` + `UPDATE personal_report_setting SET daily_template_made = daily_template_page_id IS NOT NULL, weekly_template_made = weekly_template_page_id IS NOT NULL;`
  - `SettingRow` 에 필드 추가(끝에): `Long reportLocationPageId, boolean templateInitialized, boolean dailyTemplateMade, boolean weeklyTemplateMade, OffsetDateTime templateRecreatedAt`. `defaults` 는 null/false/null.
  - `PersonalReportSettingRepository`: `void setTemplate(long userId, PersonalReportKind kind, long pageId, boolean recreated)`(그 종류 id + `*_template_made=true`, recreated 면 `template_recreated_at=now()`, 행 없으면 upsert — MONTHLY 는 주간 열), `void markTemplateInitialized(long userId)`(upsert), `void clearTemplateRecreated(long userId)`(값이 있을 때만), `void setLocation(long userId, Long pageId)`(upsert), `void clearLocationIf(long userId, long expected)`(그 값일 때만 NULL). 기존 3-인자 `setTemplate` 은 지운다(호출부는 Task 2 가 바꾼다 — 이 과제에서는 컴파일되게 `recreated=false` 로 호출부를 맞춰 둔다).
  - `PersonalReportMonthFolder`(final, 패키지 공개): `static Optional<YearMonth> parse(String title)`, `static boolean isMonthFolder(String title)`.
  - `WikiSystemPageWriter`: `Optional<Long> findPersonalSpace(long userId)`, `long ensurePersonalSpace(long userId)`, `Optional<Long> findPersonalReportsPage(long spaceId)`, `long ensurePersonalReportsPage(long spaceId, long userId)`. (기존 `ensurePersonalReportsHome`/`findPersonalReportsHome`/`PersonalReportsHome` 은 Task 4 에서 지운다.)
  - `PersonalReportLocation`(@Component): `record Resolved(long spaceId, long parentPageId)`, `record Description(Long spaceId, Long locationPageId, List<String> locationPath, Long templatesRootId)`, `Resolved resolveForWrite(long userId)`, `Description describe(long userId)`, `void validateChoice(long userId, long pageId)`, 상수 `DEFAULT_TITLE="보고"`·위 400 문구 네 개(`NOT_IN_SPACE`·`UNDER_TEMPLATE`·`UNDER_AI_REPORT`·`UNDER_MONTH_FOLDER`).

규칙(`ProjectReportLocation` 과 같은 모양, 다른 점만):
- 「막힘」 = 맨 위 「템플릿」 갈래(자기 포함) 또는 설정의 일일·주간 템플릿 갈래(자기 포함, 공간 안일 때) 또는 `pathTitles(pageId)` 중 하나라도 달 폴더 제목. 저장 검증·생성·설명이 같은 판정을 쓴다.
- `validateChoice` 순서: 공간 없음·공간 밖 → `NOT_IN_SPACE`; 템플릿 갈래 → `UNDER_TEMPLATE`; 달 폴더 갈래 → `UNDER_MONTH_FOLDER`; 페이지 자신의 `aiLastAction == AI_ACTION_REPORT` → `UNDER_AI_REPORT`.
- `resolveForWrite`: 공간 보장(`ensurePersonalSpace`) → 저장값이 공간 안·안 막힘이면 그것 → 다른 공간(또는 없는 페이지)이면 `clearLocationIf` 후 「보고」 → 공간 안인데 막힘이면 이번만 「보고」(저장값 유지) → 「보고」는 `ensurePersonalReportsPage`.
- `describe`: 아무것도 만들지 않는다. 공간 없으면 `(null, null, ["보고"], null)`. 유효한 저장값이면 `(space, chosen, pathTitles(chosen), templatesRoot)`, 아니면 `(space, 「보고」 id 또는 null, ["보고"], templatesRoot)`.

- [ ] **Step 1: 저장소 테스트 추가** — `PersonalReportSettingRepositoryTest`: `setTemplate_recreated_setsMadeAndRecreatedAt`(recreated=true → `dailyTemplateMade` true, `templateRecreatedAt` not null, 주간 made false), `setTemplate_notRecreated_keepsRecreatedAtNull`, `clearTemplateRecreated_clears`, `markTemplateInitialized_upsertsRow`(행 없을 때도), `setLocation_andClearLocationIf_onlyWhenSameValue`(다른 값이면 그대로), `migration_backfillsMadeFromExistingIds` 는 생략(마이그레이션 UPDATE 는 리뷰로 본다).
- [ ] **Step 2: 해석기 테스트 작성** — `PersonalReportLocationTest`(IntegrationTestBase, 실제 사용자·내 노트 공간): `describe_noChoice_defaultsToReportsPath`(경로 `["보고"]`, 「보고」 없으면 locationPageId null, 아무것도 만들지 않음), `describe_validChoice_returnsPath`(「업무 일지 › 팀」 고름 → 경로 `["업무 일지","팀"]`), `resolveForWrite_validChoice_doesNotCreateReports`(「보고」 페이지가 생기지 않음), `resolveForWrite_deletedChoice_fallsBackToReports`(페이지 삭제 → FK NULL → 「보고」 생성), `resolveForWrite_movedToOtherSpace_clearsSetting`(저장값 NULL 이 됨), `resolveForWrite_movedUnderTemplates_usesReportsButKeepsSetting`, `validateChoice_otherSpace_rejected`, `validateChoice_templatesBranch_rejected`(「템플릿」 자신·그 아래·일일 템플릿 자신), `validateChoice_aiReport_rejected`, `validateChoice_underMonthFolder_rejected`(「보고 › 2026년 11월」 자신과 그 아래 사람이 만든 페이지 둘 다), `validateChoice_monthLikeTitleOutOfRange_allowed`(「2026년 13월」 은 허용). 메시지는 위 상수와 같은지 본다.
- [ ] **Step 3: 실패 확인** — `cd apps/workplace-api` 에서 `./gradlew test --tests "*.PersonalReportLocationTest" --tests "*.PersonalReportSettingRepositoryTest"` → 컴파일 실패/FAIL.
- [ ] **Step 4: 구현** — 마이그레이션 → `./gradlew generateJooq`(Docker 필요) → 저장소·`PersonalReportMonthFolder`·writer 도우미·`PersonalReportLocation`. 생성기의 `parseMonthFolder` 는 `PersonalReportMonthFolder.parse` 로 바꾼다(동작 같음, 기존 생성기 테스트가 그 함수를 직접 부르면 새 이름으로).
- [ ] **Step 5: 통과 확인** — 같은 명령 PASS, 그리고 `./gradlew test --tests "com.workplace.wiki.report.*"` 가 기존과 같이 PASS(템플릿 동작은 아직 그대로).
- [ ] **Step 6: 커밋** — `git add` 위 파일 + generated → `git commit -m "feat(report): 개인 보고 저장 위치 열과 해석기를 더한다 (WP-1655)"`(트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

### Task 2: 템플릿을 「템플릿」 아래로 나누고 id 로 따라가기

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/report/PersonalReportTemplate.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/report/ReportTemplateCopier.java` (`isUnder`·안 쓰는 `copy` 제거 — 다른 호출부가 없는지 grep 으로 확인)
- Test: `apps/workplace-api/src/test/java/com/workplace/wiki/report/PersonalReportTemplateTest.java`, `PersonalReportTemplateConcurrencyTest.java`

**Interfaces:**
- Consumes: Task 1 저장소 메서드, `WikiSystemPageWriter.findPersonalSpace/ensurePersonalSpace/findPersonalReportsPage`.
- Produces (`PersonalReportTemplate`):
  - `DAILY_TITLE = "일일 보고"`, `WEEKLY_TITLE = "주간·월간 보고"`.
  - `long ensure(long userId, long spaceId, PersonalReportKind kind)` — 아직 옛 이전 전(`!templateInitialized`)이면 `relocateLegacy` 먼저. 저장된 id 가 공간 안이면 그대로(어디로 옮겼든). 아니면 `copy(..., recreated = current != null || made(kind))`.
  - `void ensureBoth(long userId)` — 공간 보장 후 일일·주간 `ensure`.
  - `void relocateLegacyIfNeeded(long userId)` — 공간·「보고」는 찾기만. 공간 없으면 아무것도 안 함. `!templateInitialized` 면 `relocateLegacy`.
  - `void reset(long userId, PersonalReportKind kind)` — 공간 보장 → `relocateLegacyIfNeeded` → 공간 안이면 `copier.overwrite`, 아니면 `copy(recreated=false)`.
  - `String readBodyOrDefault(long templateId, PersonalReportKind kind)` 그대로.
- 옛 이전(`relocateLegacy`, 한 트랜잭션): `lockSpaceTree` → 행 다시 읽기 → 이미 initialized 면 끝 → 「보고」 루트가 있으면, 부모가 「보고」 루트인(`existsUnder`) 일일·주간 템플릿 각각을 `ensureTemplatesPage` 아래로 옮기고(일일 0번, 주간은 일일 다음) `renameTo` 새 제목(본문 그대로) → 어떤 경우든 `markTemplateInitialized`. 사람이 이미 다른 곳으로 옮긴 템플릿은 그대로 둔다.
- 복사(`copy`): 잠금 → 다시 읽어 공간 안이면 그것 → `ensureTemplatesPage` → `createPage(제목)` → 일일은 0번, 주간은 일일이 「템플릿」 바로 아래 있으면 그 다음, 아니면 0번 → `setTemplate(userId, kind, id, recreated)` → 커밋 뒤 이 호출이 만든 페이지에만 본문.

- [ ] **Step 1: 테스트 고치기·추가** — `PersonalReportTemplateTest`: 제목 기대값을 새 제목으로, 부모를 「템플릿」 으로(「보고」 는 만들어지지 않음). 추가: `ensureBoth_firstEnable_noRecreatedNotice`(`templateRecreatedAt` null, 「템플릿」 아래 순서 [일일 보고, 주간·월간 보고]), `ensure_movedWithinSpace_keepsUsing`(템플릿을 「업무 일지」 아래로 옮겨도 같은 id, 새 페이지 없음 — 기존 `ensure_recopiesWhenMovedOutOfReports` 를 이 기대로 바꿈), `ensure_deleted_recreatesWithNotice`(지움 → 「템플릿」 아래 새로, `templateRecreatedAt` not null), `ensure_movedToOtherSpace_recreatesWithNotice`, `ensure_firstWeeklyAfterManualDailyOnly_noNotice`(일일만 만든 행에서 주간 처음 복사 → 알림 없음), `relocateLegacy_movesBothOnceAndRenames`(옛 제목 「템플릿 · 일일 보고」·「템플릿 · 주간 보고」를 「보고」 0·1번에 두고 initialized=false 행 → 이전 뒤 「템플릿」 아래 새 제목, 본문 바이트 그대로, initialized=true, 두 번째 호출은 아무것도 안 함), `relocateLegacy_leavesUserMovedTemplate`(이미 「업무 일지」 아래 옮긴 템플릿은 그대로, initialized=true), `relocateLegacyIfNeeded_noSpace_createsNothing`, `reset_*` 는 「보고」 대신 공간 안 기준으로. 동시성 테스트는 제목·부모 기대만 맞춘다.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*.PersonalReportTemplate*"` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces 대로. `ReportTemplateCopier.isUnder` 를 쓰던 `PersonalReportSettingsService.templateIfUnder` 는 이 과제에서 `writer.findPersonalSpace(userId)` + `existsInSpace` 로 바꿔 컴파일되게 한다(응답 모양은 Task 3). 생성기의 `template.ensure(userId, home, kind)` 호출은 `template.ensure(userId, home.spaceId(), kind)` 로 맞춘다(위치 변경은 Task 4).
- [ ] **Step 4: 통과 확인** — `./gradlew test --tests "com.workplace.wiki.report.*"` PASS(생성기 테스트 중 「보고」 아래 템플릿 두 장을 기대하던 단언은 이 과제에서 새 기대로 고친다: 「보고」 아래에는 달 폴더만).
- [ ] **Step 5: 커밋** — `feat(report): 개인 보고 템플릿을 「템플릿」 아래로 나누고 id 로 따라간다 (WP-1655)`.

### Task 3: 설정 서비스·응답·위치 저장 API

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/report/PersonalReportSettingsService.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/report/PersonalReportController.java` (경로는 그 파일 위치 그대로)
- Modify: `.../dto/PersonalReportSettingsResponse.java`; Create `.../dto/UpdatePersonalReportLocationRequest.java`(`@NotNull Long pageId`)
- Test: `PersonalReportSettingsServiceTest.java`, `PersonalReportControllerTest.java`

**Interfaces:**
- Consumes: Task 1 `PersonalReportLocation`, Task 2 `PersonalReportTemplate`.
- Produces:
  - `PersonalReportSettingsResponse(boolean dailyEnabled, String timeOfDay, boolean skipEmpty, Long dailyTemplatePageId, Long weeklyTemplatePageId, List<String> dailyTemplatePath, List<String> weeklyTemplatePath, Long templateRootPageId, OffsetDateTime templateRecreatedAt, Long reportsPageId, List<String> reportLocationPath, Long spaceId, OffsetDateTime nextRunAt, boolean assistantAvailable, String lastError)` — 템플릿 id·경로는 공간 안일 때만(아니면 null), `reportsPageId`·`reportLocationPath`·`spaceId`·`templateRootPageId` 는 `location.describe`.
  - `PersonalReportSettingsResponse updateLocation(long userId, long pageId)`.
  - `PUT /api/v1/me/report-settings/location` body `UpdatePersonalReportLocationRequest` → 200 전체 설정 응답, 400 은 검증 문구.
- 서비스 규칙: `update` = 시각 검사 → `beginWrite`(짧은 tx 로 `clearTemplateRecreated` + `template.relocateLegacyIfNeeded`) → 켜져 있으면 `template.ensureBoth` → 저장(기존 일정 규칙 그대로). `resetTemplate` = 월간 400 → `beginWrite` → `reset`. `updateLocation` = `validateChoice` → `beginWrite` → 짧은 tx `setLocation` → `get`.

- [ ] **Step 1: 테스트** — 서비스: `get_noReportsYet_returnsPersonalSpaceIdAndDefaultPath`(「보고」 없어도 `spaceId` 있음, 경로 `["보고"]`), `get_templatePaths`(기본 `["템플릿","일일 보고"]`·`["템플릿","주간·월간 보고"]`; 옮기면 실제 경로), `get_templateMovedWithinSpace_keepsId`(기존 `get_templateMovedOut_hidesTemplateId` 를 공간 안 이동 → id 유지로 바꾸고, 다른 공간 이동 → null 을 따로), `update_savesAgain_relocatesLegacyTemplates`(켜진 채 저장만 해도 옛 템플릿 이전), `update_enabled_recreatesDeletedTemplate_andShowsNotice`, `update_nextWrite_clearsNotice`, `updateLocation_valid_savesAndDescribes`(응답 `reportsPageId`=고른 id, 경로), `updateLocation_rejected_hasNoSideEffects`(400 이고 옛 템플릿이 「보고」 아래 그대로·알림 그대로·저장값 그대로), `resetTemplate_monthly_rejectedBeforeSideEffects`. 컨트롤러: `PUT location` 200 응답 필드, `pageId` 없음 400, 다른 공간 페이지 400 문구.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*.PersonalReportSettingsServiceTest" --tests "*.PersonalReportControllerTest"` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces. `ReportTemplateCopier` 를 더 쓰지 않으면 서비스 생성자에서 뺀다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS + `./gradlew test --tests "com.workplace.wiki.report.*"`.
- [ ] **Step 5: 커밋** — `feat(report): 개인 보고 설정에 저장 위치 저장과 템플릿 경로를 더한다 (WP-1655)`.

### Task 4: 생성기가 고른 위치 아래 달 폴더에 쓴다

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/report/PersonalReportGenerator.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/wiki/service/WikiSystemPageWriter.java` (쓰는 곳이 없어진 `ensurePersonalReportsHome`·`findPersonalReportsHome`·`PersonalReportsHome` 제거 — grep 으로 확인)
- Test: `PersonalReportGeneratorTest.java`, `PersonalReportGeneratorConcurrencyTest.java`, `apps/workplace-api/src/test/java/com/workplace/wiki/service/WikiSystemPageWriterTest.java`(지운 메서드 테스트를 새 도우미 테스트로)

**Interfaces:**
- Consumes: `PersonalReportLocation.resolveForWrite(userId) → Resolved(spaceId, parentPageId)`, `PersonalReportTemplate.ensure(userId, spaceId, kind)`, `ReportPageWriter.writeAndMarkInPlace(author, page, body, now, false)`.
- Produces: `static int monthFolderPosition(List<String> siblings, String title)` — 템플릿 수 인자 제거(달 폴더가 없으면 0). `templatesUnder` 제거.
- `writePage` 는 `Resolved target` 을 받는다. 달 폴더 = `ensureChildFolder(target.spaceId(), target.parentPageId(), folderTitle, userId, siblings -> monthFolderPosition(siblings, folderTitle))`. 재사용 페이지(`pendingPageId`)의 부모가 그 달 폴더가 아니면 `writeAndMarkInPlace`(옮기지 않음), 같으면 지금처럼 `writeAndMark(..., folderId, 0, now)`. 새 페이지는 지금처럼.

- [ ] **Step 1: 테스트** — `monthFolderPosition_ordersByMonthDescending` 을 2-인자로(빈 형제 → 0, 사람 페이지 사이에서도 최신 달이 첫 달 폴더 자리). `assertReportsChildren` 기대를 「달 폴더만」으로. 추가: `generate_chosenLocation_writesUnderItsMonthFolder`(「업무 일지」 고름 → 「업무 일지 › 2026년 11월 › 보고 제목」), `generate_chosenLocation_doesNotCreateReportsHome`(내 노트 최상위에 「보고」 없음), `generate_chosenDeleted_fallsBackToReports`, `generate_retryAfterLocationChange_keepsPendingPageInPlace`(대기 페이지가 옛 「보고 › 2026년 11월」 에 있고 위치를 바꾼 뒤 재시도 → 페이지 부모 그대로, 본문 갱신·AI 표지), `generate_legacyTemplates_relocatedOnGenerate`, `generate_recopiesDeletedTemplate` 는 「템플릿」 아래 기대로.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*.PersonalReportGenerator*"` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces. 생성기 주석(「「보고」 안 템플릿 다음 자리」)도 새 규칙으로.
- [ ] **Step 4: 통과 확인** — `./gradlew test --tests "com.workplace.wiki.*"` PASS, `./gradlew spotlessApply` 후 `./gradlew compileJava compileTestJava`.
- [ ] **Step 5: 커밋** — `feat(report): 개인 보고를 고른 저장 위치 아래 달 폴더에 만든다 (WP-1655)`.

### Task 5: 공용 고르기 창 일반화와 달 폴더 판정(웹)

**Files:**
- Create: `apps/workplace-web/src/lib/reportMonthFolder.ts` + `reportMonthFolder.test.ts`
- Modify: `apps/workplace-web/src/components/wiki/ReportLocationDialog.tsx` + `ReportLocationDialog.test.tsx`

**Interfaces:**
- Produces: `isMonthFolderTitle(title: string): boolean`(전역 규칙대로, 월 1–12). `ReportLocationDialog` 새 선택 props `isBlockedPage?: (page: WikiPageSummary) => boolean`(참이면 그 페이지와 그 아래를 뺀다 — 단 지금 위치와 그 조상은 AI 보고 규칙처럼 남긴다), `emptyText?: string`(기본은 지금 문구 `고를 페이지가 없으면 다음 리포트 때 「{home}」을 만들어요.`). 프로젝트 쪽 호출·동작은 그대로.

- [ ] **Step 1: 테스트** — 순수 함수: `'2026년 11월'`·`'2026년 1월'` 참, `'2026년 13월'`·`'2026년 0월'`·`'2026년 11월 회의'`·`'26년 11월'` 거짓. 창: `달 폴더와 그 아래를 뺀다`(isBlockedPage 로 「2026년 11월」과 그 아래 사람 페이지가 목록에 없음, 다른 페이지는 있음), `emptyText 를 쓴다`(빈 트리에서 주어진 문구), 기존 프로젝트 테스트는 그대로 PASS.
- [ ] **Step 2: 실패 확인** — `cd apps/workplace-web` 에서 `pnpm vitest run src/lib/reportMonthFolder.test.ts src/components/wiki/ReportLocationDialog.test.tsx` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(wiki): 저장 위치 고르기 창이 페이지 판정과 빈 안내를 받는다 (WP-1655)`.

### Task 6: 보고서 설정 창·만들기 창(웹)

**Files:**
- Modify: `apps/workplace-web/src/types/meReport.ts`, `src/api/meReports.ts`, `src/hooks/queries/useMeReports.ts`, `src/test/msw/baseHandlers.ts`(`/me/report-settings` 기본 응답에 새 필드)
- Modify: `src/pages/me/overview/reports/ReportSettingsDialog.tsx` + `.test.tsx`
- Modify: `src/pages/me/overview/reports/meReportModel.ts`(+test), `CreateReportDialog.tsx`(+test)

**Interfaces:**
- Consumes: Task 3 응답 필드(`dailyTemplatePath`·`weeklyTemplatePath`·`templateRootPageId`·`templateRecreatedAt`·`reportsPageId`·`reportLocationPath`·`spaceId`), `PUT /me/report-settings/location`, Task 5 props·`isMonthFolderTitle`.
- Produces: `MeReportSettings` 새 필드(경로는 `string[] | null`, 시각 `string | null`), `updateMeReportLocation(pageId: number): Promise<MeReportSettings>`, `useUpdateMeReportLocation()`(성공 시 응답을 `meReportKeys.settings` 캐시에 넣는다), `useMeReport` 가 GENERATED 를 받으면 `meReportKeys.settings` 도 무효화. `monthFolderLabel(kind, value, basePath?: string[])`(기본 `['보고']`, 결과 `내 노트 › {basePath › 이음} › {달}`).
- 설정 창: 링크 글자 = 경로 `' › '` 로 이음(없으면 전역 기본 문구), 행 이름 `주간·월간 템플릿`·설명 `필요할 때 만들기`, `저장 위치` 행 = 링크(`reportsPageId` 있을 때, 없으면 글자) + `spaceId != null` 일 때 `바꾸기`(outline sm) → `ReportLocationDialog`(`spaceId`, `currentPageId=reportsPageId`, `blockedRootIds=[templateRootPageId, dailyTemplatePageId, weeklyTemplatePageId]` 중 null 아닌 것 — `useMemo`, `title`·`home="보고"`·`description`·`emptyText`·`helpId` 전역 값, `isBlockedPage={(p) => isMonthFolderTitle(p.title)}`, `saving`). 저장 성공 → 토스트 `저장 위치를 바꿨어요` + 닫기, 실패 → `handleApiError` + 창 유지. `templateRecreatedAt` 이 있으면 템플릿 행 아래 `템플릿을 다시 만들었어요`(testid `me-report-template-recreated`). 머리 주석의 행 설명을 새 동작으로.
- 만들기 창: 「저장 위치」 문구를 설정의 `reportLocationPath` 로.

- [ ] **Step 1: 테스트** — `ReportSettingsDialog.test.tsx`: 링크 이름 `템플릿 › 일일 보고`·`템플릿 › 주간·월간 보고`(경로 응답이 있으면 그 경로), 행 이름 `주간·월간 템플릿`, 「· 월간도 이 템플릿」 없음, `저장 위치` 링크 `내 노트 › 업무 일지 › 팀`, `바꾸기` → 창 제목 `보고 저장 위치` → 행 고르고 저장 → PUT 본문 `{ pageId }` → 토스트·창 닫힘·행 글자 갱신, 400 → 창 유지·오류 토스트, 창 목록에 달 폴더·「템플릿」 갈래 없음, `spaceId` null 이면 `바꾸기` 없음, `templateRecreatedAt` 있으면 알림 문구. `meReportModel.test.ts`·`CreateReportDialog.test.tsx`: 고른 경로 기준 문구. `useMeReport` 무효화는 기존 훅 테스트가 있으면 거기, 없으면 설정 창 테스트에서 생략(리뷰로 본다).
- [ ] **Step 2: 실패 확인** — `pnpm vitest run src/pages/me/overview/reports` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `pnpm typecheck`, `pnpm lint` PASS.
- [ ] **Step 5: 커밋** — `feat(me): 보고서 설정에서 템플릿 경로를 보이고 저장 위치를 바꾼다 (WP-1655)`.

### Task 7: 매뉴얼

**Files:**
- Modify: `docs/manual/user/08-work.md`(개인 보고 절 — 「내 일일·주간·월간 보고를 받는다」 4단계, 「보고서를 설정한다」 표, 새 소절 `#### 보고 저장 위치를 바꾼다 {help=me.reports.location}`), 필요하면 `docs/manual/shots/targets.md`(그림 재촬영 필요 표시만)

- [ ] **Step 1: 고치기** — 스킬 `manual-authoring` 규칙대로: 템플릿은 「내 노트 › 템플릿」 아래 `일일 보고`·`주간·월간 보고`, 옮겨도 따라가고 공간 밖으로 옮기거나 지우면 다시 만듦, `주간·월간 템플릿` 행 이름, `저장 위치` 의 `바꾸기` 와 고르기 규칙(템플릿·AI 보고·달 폴더는 고를 수 없음, 이미 만든 보고는 그대로, 고른 페이지가 없어지면 「보고」 로).
- [ ] **Step 2: 확인** — 저장소 루트에서 `pnpm manual:check` 와 `pnpm manual:prose` PASS.
- [ ] **Step 3: 커밋** — `docs(manual): 개인 보고 템플릿 위치와 저장 위치 바꾸기를 적는다 (WP-1655)`.
