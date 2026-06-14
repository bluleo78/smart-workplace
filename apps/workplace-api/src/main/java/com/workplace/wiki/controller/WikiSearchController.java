package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiSearchResult;
import com.workplace.wiki.service.WikiPageService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 위키 검색(읽기 그라운딩, S2). AI 에이전트 및 향후 UI 가 공용으로 사용. */
@RestController
@RequestMapping("/api/v1/wiki/search")
public class WikiSearchController {

  private final WikiPageService pageService;

  public WikiSearchController(WikiPageService pageService) {
    this.pageService = pageService;
  }

  /** 제목·본문으로 위키 페이지 검색. spaceId 미지정 시 호출자 멤버 스페이스 전체. */
  @GetMapping
  public ResponseEntity<List<WikiSearchResult>> search(
      @AuthenticationPrincipal Long callerId,
      @RequestParam("q") String q,
      @RequestParam(value = "spaceId", required = false) Long spaceId) {
    return ResponseEntity.ok(pageService.search(callerId, q, spaceId));
  }
}
