package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiSearchResult;
import com.workplace.wiki.service.WikiPageService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 위키 검색(읽기 그라운딩, S2). AI 에이전트 및 향후 UI 가 공용으로 사용. */
@Validated
@RestController
@RequestMapping("/api/v1/wiki/search")
public class WikiSearchController {

  private final WikiPageService pageService;

  public WikiSearchController(WikiPageService pageService) {
    this.pageService = pageService;
  }

  /**
   * 제목·본문으로 위키 페이지 검색. spaceId 미지정 시 호출자 멤버 스페이스 전체. size·offset 은 통합 검색 팔레트(WP-1353)의 페이지 이어 받기용 —
   * 생략하면 예전과 같이 앞 50건이다.
   */
  @GetMapping
  public ResponseEntity<List<WikiSearchResult>> search(
      @AuthenticationPrincipal Long callerId,
      @RequestParam("q") String q,
      @RequestParam(value = "spaceId", required = false) Long spaceId,
      @RequestParam(value = "size", required = false, defaultValue = "50")
          @Min(value = 1, message = "size 는 1~50 이어야 합니다")
          @Max(value = 50, message = "size 는 1~50 이어야 합니다")
          int size,
      @RequestParam(value = "offset", required = false, defaultValue = "0")
          @Min(value = 0, message = "offset 은 0 이상이어야 합니다")
          int offset) {
    return ResponseEntity.ok(pageService.search(callerId, q, spaceId, size, offset));
  }
}
