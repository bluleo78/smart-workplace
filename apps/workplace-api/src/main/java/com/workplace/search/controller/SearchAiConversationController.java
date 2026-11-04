package com.workplace.search.controller;

import com.workplace.search.dto.AiConversationPage;
import com.workplace.search.service.SearchAiConversationService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 통합 검색 팔레트(WP-1360)의 AI 대화 검색 API. 서비스만 부른다. */
@Validated
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/search")
public class SearchAiConversationController {

  private final SearchAiConversationService service;

  /** 호출자 본인의 지난 AI 대화를 키워드로 찾는다. q 가 2자 미만이면 빈 결과. */
  @GetMapping("/ai-conversations")
  public ResponseEntity<AiConversationPage> aiConversations(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "q", required = false) String q,
      @RequestParam(value = "offset", required = false, defaultValue = "0")
          @Min(value = 0, message = "offset 은 0 이상이어야 합니다")
          int offset,
      @RequestParam(value = "size", required = false, defaultValue = "20")
          @Min(value = 1, message = "size 는 1~50 이어야 합니다")
          @Max(value = 50, message = "size 는 1~50 이어야 합니다")
          int size) {
    return ResponseEntity.ok(service.search(callerId, q, offset, size));
  }
}
