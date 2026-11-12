package com.workplace.wiki.report;

import com.workplace.issue.report.ReportTableRow;
import java.util.List;
import java.util.function.Predicate;

/**
 * 리포트 표 하나의 모양(WP-1486) — {@link ReportMarkdown#fixTable} 이 AI 글 속 표를 찾아 시스템 값으로 다시 쓰고, 없으면 넣을 때
 * 쓴다. 프로젝트 리포트(WP-1483)의 「지난 리포트 이후」 표와 개인 보고의 「어제 숫자」·「지난주 대비」 표가 같은 후처리를 나눠 쓰게 표 모양만 값으로 뺐다.
 *
 * @param headFirstCell 머리 첫 칸(굵게·앞뒤 공백을 뗀 글)을 받아 이 표의 머리인지 판정한다
 * @param headCells 시스템이 정한 머리 칸 — null 이면 찾은 표의 머리·구분 줄을 그대로 두고 몸통만 다시 쓴다(프로젝트). null 이 아니면 머리 줄·구분
 *     줄({@code |---|…|}, 칸 수 맞춤)까지 이 값으로 다시 쓴다(개인 일일 — 칸 자체가 시스템 지표)
 * @param body 몸통 행(행마다 칸 값). 칸 값의 「|」 는 쓸 때 이스케이프한다
 * @param insertSectionTitle 표가 없을 때 표 앞에 넣는 h2 제목. headCells 가 null 이면 넣는 표의 머리도 {@code | 이 제목 | 이번
 *     | 변화 |} 로 만든다(프로젝트 표의 머리 모양)
 * @param insertAfterSection 표를 넣을 자리 — 제목이 이 글로 시작하는 섹션의 끝. 섹션이 없으면 첫 문단 뒤
 */
public record ReportTableSpec(
    Predicate<String> headFirstCell,
    List<String> headCells,
    List<List<String>> body,
    String insertSectionTitle,
    String insertAfterSection) {

  /** 프로젝트 리포트 표의 머리 첫 칸 접두이자 넣을 때의 섹션 제목. */
  static final String PROJECT_TABLE_HEAD = "지난 리포트 이후";

  /** 프로젝트 리포트에서 표를 둘 섹션(배지 줄 섹션). */
  static final String PROJECT_STATUS_SECTION = "상태와 한 줄";

  /**
   * 프로젝트 리포트(WP-1483)의 「지난 리포트 이후」 표 — 머리 첫 칸이 「지난 리포트 이후」 로 시작하는 표의 몸통만 계산값 행으로 다시 쓰고, 없으면 「상태와 한
   * 줄」 섹션 뒤에 {@code | 지난 리포트 이후 | 이번 | 변화 |} 표를 넣는다.
   */
  public static ReportTableSpec project(List<ReportTableRow> rows) {
    List<List<String>> body =
        rows.stream().map(r -> List.of(nz(r.label()), nz(r.current()), nz(r.change()))).toList();
    return new ReportTableSpec(
        s -> s.startsWith(PROJECT_TABLE_HEAD),
        null,
        body,
        PROJECT_TABLE_HEAD,
        PROJECT_STATUS_SECTION);
  }

  /** null 칸은 빈 칸 — List.of 가 null 을 받지 않아서 여기서 바꾼다(기존 표 쓰기도 null 을 빈 칸으로 썼다). */
  private static String nz(String v) {
    return v == null ? "" : v;
  }
}
