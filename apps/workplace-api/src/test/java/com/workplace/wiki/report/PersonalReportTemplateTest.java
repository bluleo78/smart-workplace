package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportFactsService;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 템플릿 두 벌(WP-1486, WP-1655 에서 「템플릿」 아래로 분리) — 내 노트 맨 위 「템플릿」 아래 복사(「보고」는 만들지 않음)·id 로 따라가기(공간
 * 안 이동은 그대로, 지움·다른 공간 이동은 다시 만들고 알림)·첫 켜기는 알리지 않음·옛 「보고」 아래 템플릿 한 번 옮기기(제목만 바꿈, 본문 그대로)·기본 원문·되돌리기.
 */
@Transactional
class PersonalReportTemplateTest extends ExternalClientMockedTestBase {

  /** 옛 구조(WP-1486)의 템플릿 제목 — 이전 테스트가 「보고」 아래에 직접 만든다. */
  private static final String LEGACY_DAILY = "템플릿 · 일일 보고";

  private static final String LEGACY_WEEKLY = "템플릿 · 주간 보고";

  @Autowired DSLContext dsl;
  @Autowired PersonalReportTemplate template;
  @Autowired PersonalReportSettingRepository settings;
  @Autowired WikiSystemPageWriter writer;
  @Autowired WikiPageService pageService;
  @Autowired ProjectService projectService;

  private long userId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    userId = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(userId);
  }

  private List<String> childTitles(long parentId) {
    return writer.childIdsOrdered(parentId).stream()
        .map(id -> writer.findPage(id).orElseThrow().title())
        .toList();
  }

  private SettingRow row() {
    return settings.find(userId).orElseThrow();
  }

  private long space() {
    return writer.findPersonalSpace(userId).orElseThrow();
  }

  private long templatesRoot() {
    return writer.findTemplatesPage(space()).orElseThrow();
  }

  /** 내가 OWNER 인 다른 공간 — 새 프로젝트의 노트 공간. */
  private long otherSpace() {
    String key = uniqueProjectKey("PT");
    long projectId =
        projectService
            .create(userId, new CreateProjectRequest(key, "템플릿-" + key, null, "TEAM"))
            .id();
    return writer.ensureProjectSpace(projectId).orElseThrow();
  }

  /** 페이지에 본문을 쓴다(사람 글). */
  private void writeBody(long pageId, String body) {
    WikiPageDetail current = pageService.get(userId, pageId);
    pageService.save(userId, pageId, new SavePageRequest(null, body, current.version(), false));
  }

  // ───────────── 복사·따라가기 ─────────────

  /** 켤 때 일일·주간을 「템플릿」 아래 [일일 보고, 주간·월간 보고] 순으로 한 번씩만 복사하고, 설정 두 칸에 적는다. 「보고」는 만들지 않는다. */
  @Test
  void ensureBoth_copiesTwoTemplatesUnderTemplates_once() {
    template.ensureBoth(userId);
    template.ensureBoth(userId);

    long root = templatesRoot();
    assertThat(childTitles(root)).containsExactly("일일 보고", "주간·월간 보고");
    assertThat(writer.findPage(root).orElseThrow().parentId()).isNull();
    List<Long> children = writer.childIdsOrdered(root);
    assertThat(row().dailyTemplatePageId()).isEqualTo(children.get(0));
    assertThat(row().weeklyTemplatePageId()).isEqualTo(children.get(1));
    assertThat(writer.findPersonalReportsPage(space())).isEmpty();
  }

  /** 처음 켤 때 두 템플릿을 만들어도 「다시 만들었어요」로 알리지 않는다(일일 직후 주간을 다시 만듦으로 보지 않음). 옛 이전 판정도 마친다. */
  @Test
  void ensureBoth_firstEnable_noRecreatedNotice() {
    template.ensureBoth(userId);

    SettingRow r = row();
    assertThat(r.templateRecreatedAt()).isNull();
    assertThat(r.templateInitialized()).isTrue();
    assertThat(r.dailyTemplateMade()).isTrue();
    assertThat(r.weeklyTemplateMade()).isTrue();
    assertThat(childTitles(templatesRoot()))
        .containsExactly(PersonalReportTemplate.DAILY_TITLE, PersonalReportTemplate.WEEKLY_TITLE);
  }

  /** 템플릿을 같은 공간의 다른 페이지 아래로 옮겨도 그 id 를 그대로 쓰고, 새로 만들지 않는다. */
  @Test
  void ensure_movedWithinSpace_keepsUsing() {
    template.ensureBoth(userId);
    long daily = row().dailyTemplatePageId();
    long log = writer.createPage(userId, space(), null, "업무 일지").id();
    writer.moveTo(daily, log, 0);

    long again = template.ensure(userId, space(), PersonalReportKind.DAILY);

    assertThat(again).isEqualTo(daily);
    assertThat(writer.childIdsOrdered(templatesRoot()))
        .containsExactly(row().weeklyTemplatePageId());
    assertThat(row().templateRecreatedAt()).isNull();
  }

  /** 템플릿을 지웠으면(FK 로 id 가 비어도) 「템플릿」 맨 위에 다시 만들고 알림 시각을 남긴다. */
  @Test
  void ensure_deleted_recreatesWithNotice() {
    template.ensureBoth(userId);
    long old = row().dailyTemplatePageId();
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(old)).execute();
    assertThat(row().dailyTemplatePageId()).isNull();

    long again = template.ensure(userId, space(), PersonalReportKind.DAILY);

    assertThat(again).isNotEqualTo(old);
    assertThat(writer.childIdsOrdered(templatesRoot()))
        .containsExactly(again, row().weeklyTemplatePageId());
    assertThat(row().dailyTemplatePageId()).isEqualTo(again);
    assertThat(row().templateRecreatedAt()).isNotNull();
  }

  /** 템플릿을 다른 공간으로 옮겼으면 「템플릿」 아래(일일 다음)에 다시 만들고 알림 시각을 남긴다. 옮긴 페이지는 건드리지 않는다. */
  @Test
  void ensure_movedToOtherSpace_recreatesWithNotice() {
    template.ensureBoth(userId);
    long old = row().weeklyTemplatePageId();
    long other = otherSpace();
    pageService.move(userId, old, new MovePageRequest(null, 0, other));

    long again = template.ensure(userId, space(), PersonalReportKind.WEEKLY);

    assertThat(again).isNotEqualTo(old);
    assertThat(writer.childIdsOrdered(templatesRoot()))
        .containsExactly(row().dailyTemplatePageId(), again);
    assertThat(writer.findPage(again).orElseThrow().title())
        .isEqualTo(PersonalReportTemplate.WEEKLY_TITLE);
    assertThat(writer.existsInSpace(old, other)).isTrue();
    assertThat(row().templateRecreatedAt()).isNotNull();
  }

  /** 일일만 만들어 둔 사람(수동 일일만 만듦)에게 주간을 처음 복사하는 것은 「다시 만듦」이 아니다. */
  @Test
  void ensure_firstWeeklyAfterManualDailyOnly_noNotice() {
    long spaceId = writer.ensurePersonalSpace(userId);
    long daily = template.ensure(userId, spaceId, PersonalReportKind.DAILY);
    assertThat(row().weeklyTemplateMade()).isFalse();

    long weekly = template.ensure(userId, spaceId, PersonalReportKind.MONTHLY);

    assertThat(row().templateRecreatedAt()).isNull();
    assertThat(row().weeklyTemplatePageId()).isEqualTo(weekly);
    assertThat(writer.childIdsOrdered(templatesRoot())).containsExactly(daily, weekly);
  }

  // ───────────── 옛 「보고」 아래 템플릿 옮기기 ─────────────

  /**
   * 옛 「보고」 바로 아래(0·1번)의 두 템플릿을 같은 id 로 「템플릿」 아래 [일일, 주간] 순으로 옮기고 제목만 바꾼다(본문 그대로). 한 번만 한다 — 두 번째
   * 호출은 사람이 「보고」 로 되돌려 놓은 것도 옮기지 않는다.
   */
  @Test
  void relocateLegacy_movesBothOnceAndRenames() {
    long spaceId = writer.ensurePersonalSpace(userId);
    long reports = writer.ensurePersonalReportsPage(spaceId, userId);
    long daily = writer.createPage(userId, spaceId, reports, LEGACY_DAILY).id();
    long weekly = writer.createPage(userId, spaceId, reports, LEGACY_WEEKLY).id();
    writeBody(daily, "내 일일 템플릿\n\n- 하나");
    writeBody(weekly, "내 주간 템플릿\n\n- 둘");
    String dailyBody = writer.readBody(daily).orElseThrow();
    String weeklyBody = writer.readBody(weekly).orElseThrow();
    settings.setTemplate(userId, PersonalReportKind.DAILY, daily, false);
    settings.setTemplate(userId, PersonalReportKind.WEEKLY, weekly, false);
    assertThat(row().templateInitialized()).isFalse();

    template.relocateLegacyIfNeeded(userId);

    long root = templatesRoot();
    assertThat(writer.childIdsOrdered(root)).containsExactly(daily, weekly);
    assertThat(childTitles(root))
        .containsExactly(PersonalReportTemplate.DAILY_TITLE, PersonalReportTemplate.WEEKLY_TITLE);
    assertThat(writer.readBody(daily)).hasValue(dailyBody);
    assertThat(writer.readBody(weekly)).hasValue(weeklyBody);
    assertThat(writer.childIdsOrdered(reports)).isEmpty();
    assertThat(row().templateInitialized()).isTrue();
    assertThat(row().templateRecreatedAt()).isNull();

    // 두 번째 호출은 아무것도 하지 않는다 — 사람이 「보고」 아래로 되돌려 둔 템플릿도 그 자리에 둔다.
    writer.moveTo(daily, reports, 0);
    template.relocateLegacyIfNeeded(userId);
    assertThat(writer.existsUnder(daily, reports)).isTrue();
    assertThat(template.ensure(userId, spaceId, PersonalReportKind.DAILY)).isEqualTo(daily);
  }

  /** 사람이 이미 다른 곳(「업무 일지」 아래)으로 옮긴 옛 템플릿은 그대로 두고, 「보고」 아래 남은 것만 옮긴다. 판정은 마친 것으로 적는다. */
  @Test
  void relocateLegacy_leavesUserMovedTemplate() {
    long spaceId = writer.ensurePersonalSpace(userId);
    long reports = writer.ensurePersonalReportsPage(spaceId, userId);
    long log = writer.createPage(userId, spaceId, null, "업무 일지").id();
    long daily = writer.createPage(userId, spaceId, log, LEGACY_DAILY).id();
    long weekly = writer.createPage(userId, spaceId, reports, LEGACY_WEEKLY).id();
    settings.setTemplate(userId, PersonalReportKind.DAILY, daily, false);
    settings.setTemplate(userId, PersonalReportKind.WEEKLY, weekly, false);

    template.relocateLegacyIfNeeded(userId);

    assertThat(writer.existsUnder(daily, log)).isTrue();
    assertThat(writer.findPage(daily).orElseThrow().title()).isEqualTo(LEGACY_DAILY);
    assertThat(writer.childIdsOrdered(templatesRoot())).containsExactly(weekly);
    assertThat(writer.findPage(weekly).orElseThrow().title())
        .isEqualTo(PersonalReportTemplate.WEEKLY_TITLE);
    assertThat(row().templateInitialized()).isTrue();
  }

  /** 내 노트 공간이 없으면 아무것도 만들지 않는다(공간·설정 행 모두). */
  @Test
  void relocateLegacyIfNeeded_noSpace_createsNothing() {
    template.relocateLegacyIfNeeded(userId);

    assertThat(writer.findPersonalSpace(userId)).isEmpty();
    assertThat(settings.find(userId)).isEmpty();
  }

  /** 생성기 경로(ensure)도 처음이면 옛 이전을 먼저 한다 — 옛 템플릿을 그대로 쓰고(새로 복사하지 않음) 「템플릿」 아래로 옮긴다. */
  @Test
  void ensure_notInitialized_relocatesLegacyFirst() {
    long spaceId = writer.ensurePersonalSpace(userId);
    long reports = writer.ensurePersonalReportsPage(spaceId, userId);
    long daily = writer.createPage(userId, spaceId, reports, LEGACY_DAILY).id();
    settings.setTemplate(userId, PersonalReportKind.DAILY, daily, false);

    assertThat(template.ensure(userId, spaceId, PersonalReportKind.DAILY)).isEqualTo(daily);

    assertThat(writer.childIdsOrdered(templatesRoot())).containsExactly(daily);
    assertThat(row().templateInitialized()).isTrue();
    assertThat(row().templateRecreatedAt()).isNull();
  }

  // ───────────── 기본 원문 ─────────────

  /** 일일 원문 — 섹션·지시 상자 여섯 개·일일 숫자 표가 있고 자리표시가 남지 않는다. */
  @Test
  void defaultMarkdown_daily_hasSectionsAndNoPlaceholderLeft() {
    String md = template.defaultMarkdown(PersonalReportKind.DAILY);
    assertThat(md)
        .contains("## 요약", "## 어제 숫자", "## 어제 한 일", "## 오늘 할 일", "## 막힌 것")
        .doesNotContain("{{");
    // WP-1632 새 순서 — 요약 → 어제 한 일 → 오늘 할 일 → 막힌 것 → 어제 숫자(맨 끝).
    assertThat(md.indexOf("## 어제 숫자")).isGreaterThan(md.indexOf("## 막힌 것"));
    assertThat(md).contains("- **끝낸 일** 7건 (AI와 함께 5, 직접 2)");
    assertThat(md.split("class=\"wp-ai-instruction\"", -1)).hasSize(7);
    assertThat(ReportMarkdown.hasTable(md, PersonalReportFactsService.DAILY_HEAD)).isTrue();
  }

  /** 주간 원문 — 지난주 대비 표(일곱 행)와 「잘된 것 / 놓친 것」, 월간도 같은 원문. */
  @Test
  void defaultMarkdown_weekly_hasComparisonTableAndGoodMissed() {
    String md = template.defaultMarkdown(PersonalReportKind.WEEKLY);
    assertThat(md).contains("## 잘된 것 / 놓친 것", "## 지난주 대비").doesNotContain("{{");
    assertThat(ReportMarkdown.hasTable(md, PersonalReportFactsService.PERIOD_HEAD)).isTrue();
    assertThat(md.lines().filter(l -> l.matches("\\| (끝냄|그중|기한|새로|평균).*")).count()).isEqualTo(7);
    assertThat(template.defaultMarkdown(PersonalReportKind.MONTHLY)).isEqualTo(md);
  }

  /**
   * 주간 원문의 프로젝트 표(WP-1632) — 「이번 주 한 일」 절 안, 첫 프로젝트 소제목(###) 앞에 {@code | 프로젝트 | 끝낸 일 | 주요 내용 |} 머리가
   * 있고, 후처리가 알아보는 표다. 요약의 「끝낸 일」 예시 숫자는 표 합(112 + 6 = 118)과 맞다.
   */
  @Test
  void defaultMarkdown_weekly_projectTableAtStartOfDoneSection() {
    String md = template.defaultMarkdown(PersonalReportKind.WEEKLY);
    int section = md.indexOf("## 이번 주 한 일");
    int head = md.indexOf("| 프로젝트 | 끝낸 일 | 주요 내용 |");
    int firstProject = md.indexOf("### ", section);
    assertThat(section).isPositive();
    assertThat(head).isGreaterThan(section).isLessThan(firstProject);
    assertThat(firstProject).isLessThan(md.indexOf("## 다음 주 할 일"));
    assertThat(
            ReportMarkdown.hasTable(
                md, ReportTableSpec.personalWork(List.of(), PersonalReportKind.WEEKLY)))
        .isTrue();
    assertThat(md).contains("- **끝낸 일** 118건 (AI와 함께 95, 직접 23)");
    assertThat(md).contains("| Gen:iA Works | 112건 |", "| 고객 포털 | 6건 |");
  }

  // ───────────── 되돌리기 ─────────────

  /** 되돌리기 — 고친 본문을 기본으로 덮고, 고친 판은 수정 기록에 한 건 남는다. */
  @Test
  void reset_overwritesAndKeepsPreviousRevision() {
    template.ensureBoth(userId);
    long page = row().dailyTemplatePageId();
    writeBody(page, "사람이 바꾼 본문");

    template.reset(userId, PersonalReportKind.DAILY);

    assertThat(pageService.get(userId, page).body())
        .contains("wp-ai-instruction", "## 어제 숫자")
        .doesNotContain("사람이 바꾼 본문");
    assertThat(
            dsl.fetchCount(
                WIKI_REVISION,
                WIKI_REVISION.PAGE_ID.eq(page).and(WIKI_REVISION.BODY.eq("사람이 바꾼 본문"))))
        .isEqualTo(1);
  }

  /** 되돌리기 — 공간 안 다른 곳으로 옮긴 템플릿도 그 자리에서 덮는다(새로 복사하지 않음). */
  @Test
  void reset_movedWithinSpace_overwritesInPlace() {
    template.ensureBoth(userId);
    long page = row().weeklyTemplatePageId();
    long log = writer.createPage(userId, space(), null, "업무 일지").id();
    writer.moveTo(page, log, 0);
    writeBody(page, "사람이 바꾼 본문");

    template.reset(userId, PersonalReportKind.WEEKLY);

    assertThat(row().weeklyTemplatePageId()).isEqualTo(page);
    assertThat(writer.existsUnder(page, log)).isTrue();
    assertThat(pageService.get(userId, page).body()).contains("## 지난주 대비");
  }

  /** 되돌리기 — 지운 템플릿은 「템플릿」 아래 새로 복사하되, 사람이 누른 것이라 「다시 만들었어요」로 알리지 않는다. */
  @Test
  void reset_deleted_copiesWithoutNotice() {
    template.ensureBoth(userId);
    long old = row().dailyTemplatePageId();
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(old)).execute();

    template.reset(userId, PersonalReportKind.DAILY);

    long again = row().dailyTemplatePageId();
    assertThat(again).isNotEqualTo(old);
    assertThat(writer.childIdsOrdered(templatesRoot())).first().isEqualTo(again);
    assertThat(row().templateRecreatedAt()).isNull();
  }
}
