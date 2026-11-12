package com.workplace.help.dto;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.service.HelpManualCatalog;
import java.util.List;

/**
 * 매뉴얼 절 조회 응답(WP-1510) — MCP manual 도구가 그대로 AI 에 건넨다. markdown 은 묶음 원문 그대로(자리표시·조건 블록·{@code
 * figure:<id>} 를 바꾸지 않는다), 그림은 id·alt·표식(번호·설명)만 — 그림 파일 경로(src)·표식 키는 도구가 쓰지 않아 내지 않는다.
 */
public record HelpSectionResponse(
    String id,
    String chapter,
    String chapterTitle,
    String label,
    String title,
    List<String> path,
    String markdown,
    List<Figure> figures,
    List<String> links) {

  /** 그림 하나. */
  public record Figure(String id, String alt, List<Mark> marks) {}

  /** 그림 위 번호 표식 하나. */
  public record Mark(int n, String label) {}

  /**
   * 목록 항목 → 응답. label 이 비면 title(검색 결과와 같은 규칙). links 는 호출자가 볼 수 있는 것만 거른 목록을 받는다
   * (HelpManualCatalog.lookup) — 묶음의 links 를 그대로 내면 관리자 장 절 id 가 구성원에게 드러난다.
   */
  public static HelpSectionResponse from(HelpManualCatalog.Entry e, List<String> links) {
    HelpBundle.Section s = e.section();
    return new HelpSectionResponse(
        s.id(),
        e.chapter(),
        e.chapterTitle(),
        HelpManualCatalog.labelOf(s),
        s.title(),
        e.path(),
        s.markdown(),
        s.figures().stream()
            .map(
                f ->
                    new Figure(
                        f.id(),
                        f.alt(),
                        f.marks().stream().map(m -> new Mark(m.n(), m.label())).toList()))
            .toList(),
        links);
  }
}
