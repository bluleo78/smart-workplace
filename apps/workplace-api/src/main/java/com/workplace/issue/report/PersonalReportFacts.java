package com.workplace.issue.report;

import com.workplace.wiki.report.ReportTableSpec;
import java.util.List;
import java.util.Map;

/**
 * 개인 보고 한 편의 계산값(WP-1486) — 표의 숫자는 시스템이 정하고 AI 는 글만 쓴다. 후처리({@code ReportMarkdown.fixTable})가
 * {@link #table} 로 AI 글 속 「어제 숫자」·「지난주 대비」·「지난달 대비」 표를 바로잡는다.
 *
 * @param period 회차
 * @param table 숫자 표 모양(일일 가로 한 줄, 주간·월간 세로)
 * @param issues AI 재료 이슈(이유 순, 최대 {@link PersonalReportFactsService#ISSUE_LIMIT} 건)
 * @param omittedByGroup 상한 밖으로 밀린 이슈의 에픽 제목(없으면 프로젝트 이름) → 건수(많은 순)
 * @param completed 기간 안 끝냄(개요 「어제」 칸과 같은 정의)
 * @param created 기간 안 새로 만듦(내가 보고자)
 * @param statusChanged 기간 안 상태를 바꾼 이슈 수(내가 바꿨거나 지금 내 담당)
 */
public record PersonalReportFacts(
    PersonalReportPeriod period,
    ReportTableSpec table,
    List<ReportIssue> issues,
    Map<String, Integer> omittedByGroup,
    int completed,
    int created,
    int statusChanged) {

  /** 한 일 없음(끝냄·새로 만듦·상태 바꿈 셋 다 0) — 「한 일이 없는 날은 건너뜀」 판정. */
  public boolean isEmpty() {
    return completed == 0 && created == 0 && statusChanged == 0;
  }
}
