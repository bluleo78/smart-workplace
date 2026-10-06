package com.workplace.home.service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 이력 USER 메시지의 첨부 표시(WP-234) — "본문\n[첨부: a.pdf, b.png]". 원문 이력과 누적 요약기가 같은 텍스트를 보므로 요약 뒤에도 "어떤 파일이
 * 있었는지" 흔적이 남는다. 순수 함수.
 */
public final class HomeAttachmentMarker {

  private HomeAttachmentMarker() {}

  /**
   * 본문 끝에 첨부 표시 줄을 붙인다. 파일이 없으면 본문 그대로, 본문이 비면 표시만.
   *
   * @param names 첨부 파일명(표시 순서)
   */
  public static String append(String content, List<String> names) {
    if (names == null || names.isEmpty()) return content;
    String marker =
        "[첨부: "
            + names.stream().map(HomeAttachmentMarker::clean).collect(Collectors.joining(", "))
            + "]";
    return content == null || content.isBlank() ? marker : content + "\n" + marker;
  }

  /** 파일명의 줄바꿈·대괄호를 공백으로 — 표시 한 줄을 깨거나 다른 지시처럼 보이지 않게. 비면 "파일". */
  static String clean(String name) {
    String c = name == null ? "" : name.replaceAll("[\\r\\n\\[\\]]", " ").strip();
    return c.isEmpty() ? "파일" : c;
  }
}
