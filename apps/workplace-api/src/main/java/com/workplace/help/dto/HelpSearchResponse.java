package com.workplace.help.dto;

import com.workplace.help.service.HelpSearchService.HelpSearchResult;
import java.util.List;

/** 도움말 검색 API 응답 — 점수는 내지 않는다(순서가 곧 순위). */
public record HelpSearchResponse(String mode, List<Item> results) {

  /** 결과 한 건. */
  public record Item(
      String chapter, String sectionId, String label, String title, String snippet) {}

  /** 서비스 결과를 응답으로 바꾼다. */
  public static HelpSearchResponse from(HelpSearchResult r) {
    return new HelpSearchResponse(
        r.mode().name(),
        r.hits().stream()
            .map(h -> new Item(h.chapter(), h.sectionId(), h.label(), h.title(), h.snippet()))
            .toList());
  }
}
