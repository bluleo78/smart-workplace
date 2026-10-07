package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiPageSummaryState;
import com.workplace.wiki.service.WikiSummaryService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 노트 상단 AI 요약(WP-301) — 조회(상태 계산)와 생성. 둘 다 VIEWER 이상. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki/pages")
public class WikiSummaryController {
  private final WikiSummaryService summaryService;

  /** 저장된 요약과 상태(READY/STALE/MISSING/TOO_SHORT). */
  @GetMapping("/{id}/summary")
  public WikiPageSummaryState get(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return summaryService.get(callerId, pageId);
  }

  /** 요약을 생성·저장한다(첫 생성은 웹이 자동 호출, 이후는 "다시 요약"). */
  @PostMapping("/{id}/summary")
  public WikiPageSummaryState generate(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return summaryService.generate(callerId, pageId);
  }
}
