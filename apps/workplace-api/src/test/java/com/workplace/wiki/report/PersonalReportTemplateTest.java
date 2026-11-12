package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportFactsService;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 개인 보고 템플릿 두 벌(WP-1486) — 「보고」 아래 복사·재복사·기본 원문·되돌리기. */
@Transactional
class PersonalReportTemplateTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired PersonalReportTemplate template;
  @Autowired PersonalReportSettingRepository settings;
  @Autowired WikiSystemPageWriter writer;
  @Autowired WikiPageService pageService;

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

  /** 켤 때 일일·주간 둘 다 「보고」 아래 맨 위 두 자리에 한 번씩만 복사하고, 설정 두 칸에 적는다. */
  @Test
  void ensureBoth_copiesTwoTemplatesUnderReports_once() {
    template.ensureBoth(userId);
    template.ensureBoth(userId);

    PersonalReportsHome home = writer.findPersonalReportsHome(userId).orElseThrow();
    assertThat(childTitles(home.reportsPageId()))
        .containsExactly(PersonalReportTemplate.DAILY_TITLE, PersonalReportTemplate.WEEKLY_TITLE);
    var row = settings.find(userId).orElseThrow();
    List<Long> children = writer.childIdsOrdered(home.reportsPageId());
    assertThat(row.dailyTemplatePageId()).isEqualTo(children.get(0));
    assertThat(row.weeklyTemplatePageId()).isEqualTo(children.get(1));
  }

  /** 템플릿을 지웠으면 다시 복사한다. */
  @Test
  void ensure_recopiesWhenDeleted() {
    template.ensureBoth(userId);
    PersonalReportsHome home = writer.findPersonalReportsHome(userId).orElseThrow();
    long old = settings.find(userId).orElseThrow().dailyTemplatePageId();
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(old)).execute();

    long again = template.ensure(userId, home, PersonalReportKind.DAILY);

    assertThat(again).isNotEqualTo(old);
    assertThat(writer.existsUnder(again, home.reportsPageId())).isTrue();
    assertThat(settings.find(userId).orElseThrow().dailyTemplatePageId()).isEqualTo(again);
  }

  /** 템플릿을 「보고」 밖으로 옮겼으면 다시 복사한다. */
  @Test
  void ensure_recopiesWhenMovedOutOfReports() {
    template.ensureBoth(userId);
    PersonalReportsHome home = writer.findPersonalReportsHome(userId).orElseThrow();
    long old = settings.find(userId).orElseThrow().weeklyTemplatePageId();
    dsl.update(WIKI_PAGE).setNull(WIKI_PAGE.PARENT_ID).where(WIKI_PAGE.ID.eq(old)).execute();

    long again = template.ensure(userId, home, PersonalReportKind.WEEKLY);

    assertThat(again).isNotEqualTo(old);
    assertThat(writer.existsUnder(again, home.reportsPageId())).isTrue();
  }

  /** 일일 원문 — 섹션·지시 상자 여섯 개·일일 숫자 표가 있고 자리표시가 남지 않는다. */
  @Test
  void defaultMarkdown_daily_hasSectionsAndNoPlaceholderLeft() {
    String md = template.defaultMarkdown(PersonalReportKind.DAILY);
    assertThat(md)
        .contains("## 한 줄", "## 어제 숫자", "## 어제 한 일", "## 오늘 할 일", "## 막힌 것")
        .doesNotContain("{{");
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

  /** 되돌리기 — 고친 본문을 기본으로 덮고, 고친 판은 수정 기록에 한 건 남는다. */
  @Test
  void reset_overwritesAndKeepsPreviousRevision() {
    template.ensureBoth(userId);
    long page = settings.find(userId).orElseThrow().dailyTemplatePageId();
    WikiPageDetail current = pageService.get(userId, page);
    pageService.save(
        userId, page, new SavePageRequest(null, "사람이 바꾼 본문", current.version(), false));

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
}
