package com.workplace.help.outbound;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** 도움말 매뉴얼 묶음 — 웹이 내는 장·절 목록(WP-1509). 모르는 필드는 무시해, 웹이 필드를 더해도 API 가 깨지지 않게 한다. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record HelpBundle(List<Chapter> chapters) {

  /** 장 하나 — audience 가 비면 모두, 'admin' 만 있으면 관리자 전용. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Chapter(
      String chapter, String title, List<String> audience, List<Section> sections) {}

  /** 절 하나 — markdown 은 매뉴얼 원문(그림·링크·표시가 섞여 있음). */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Section(String id, String label, String title, String markdown) {}
}
