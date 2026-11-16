package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * 기본 템플릿(WP-1629) — {@link ProjectReportTemplate#defaultMarkdown} 은 {@code {{BASE_URL}}}·{@code
 * {{PROJECT_KEY}}} 만 바꾸고, 후처리가 도표로 바꿀 「{{일정 도표}}」 자리 줄은 그대로 남긴다. 새 모양(「요약」·「참고 지표」 표)인지도 본다. 순수 단위
 * 테스트(원문 읽기 외 협력 객체는 쓰지 않는다).
 */
class ProjectReportTemplateTest {

  private static String defaultMarkdown() {
    ProjectReportTemplate template = new ProjectReportTemplate(null, null, null, null, "");
    return template.defaultMarkdown("https://x.example", "WP");
  }

  @Test
  void defaultMarkdown_keepsChartToken_replacesOnlyUrlPlaceholders() {
    String md = defaultMarkdown();

    assertThat(md).contains("\n{{일정 도표}}\n");
    assertThat(md).doesNotContain("{{BASE_URL}}").doesNotContain("{{PROJECT_KEY}}");
    assertThat(md).contains("https://x.example/projects/WP/issues/");
    assertThat(md).contains("\n## 요약\n");
    assertThat(md).endsWith("|\n").doesNotEndWith("\n\n");
  }

  @Test
  void defaultMarkdown_hasMetricsTable_noOldTable() {
    String md = defaultMarkdown();

    assertThat(ReportMarkdown.hasMetricsTable(md)).isTrue();
    assertThat(ReportMarkdown.hasReportTable(md)).isFalse();
  }
}
