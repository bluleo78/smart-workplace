package com.workplace.help.outbound;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** 도움말 매뉴얼 묶음 — 웹이 내는 장·절 목록(WP-1509). 모르는 필드는 무시해, 웹이 필드를 더해도 API 가 깨지지 않게 한다. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record HelpBundle(List<Chapter> chapters) {

  /**
   * 절이 하나도 없는 묶음인가(null 포함) — 정상 응답이 아닌 장애로 본다. 색인기(색인을 통째로 지우지 않게)와 절 목록(빈 목록으로 갈아 끼우지 않게)이 이 한 곳의
   * 판단을 함께 쓴다(WP-1510).
   */
  public static boolean hasNoSections(HelpBundle bundle) {
    return bundle == null
        || bundle.chapters() == null
        || bundle.chapters().stream()
            .allMatch(c -> c == null || c.sections() == null || c.sections().isEmpty());
  }

  /** 장 하나 — audience 가 비면 모두, 'admin' 만 있으면 관리자 전용. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Chapter(
      String chapter, String title, List<String> audience, List<Section> sections) {}

  /**
   * 절 하나 — markdown 은 매뉴얼 원문(그림·링크·표시가 섞여 있음). parent 는 감싸는 위 절 가운데 가장 가까운 도움말 id 절(없으면 null),
   * figures·links 는 절 조회(WP-1510)가 그대로 내준다. 빠진 figures·links 는 빈 목록으로 맞춰 쓰는 쪽이 null 을 따지지 않게 한다.
   */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Section(
      String id,
      String label,
      String title,
      String parent,
      String markdown,
      List<Figure> figures,
      List<String> links) {

    public Section {
      figures = figures == null ? List.of() : figures;
      links = links == null ? List.of() : links;
    }

    /** parent·그림·링크 없는 절 — 색인만 보는 시험·호출이 쓰는 짧은 꼴. */
    public Section(String id, String label, String title, String markdown) {
      this(id, label, title, null, markdown, List.of(), List.of());
    }
  }

  /** 절 그림 하나 — id 는 본문의 `figure:<id>` 와 짝, marks 는 그림 위 번호 표식과 그 설명. src·key 는 읽지 않는다(쓰는 곳 없음). */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Figure(String id, String alt, List<Mark> marks) {

    public Figure {
      marks = marks == null ? List.of() : marks;
    }
  }

  /** 그림 표식 하나 — n 은 그림 위 번호(1부터), label 은 그 번호가 가리키는 것. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Mark(int n, String label) {}
}
