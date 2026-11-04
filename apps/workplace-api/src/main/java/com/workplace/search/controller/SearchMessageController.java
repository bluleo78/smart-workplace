package com.workplace.search.controller;

import com.workplace.search.dto.MessageSearchPage;
import com.workplace.search.service.SearchMessageService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 통합 검색 팔레트(WP-1358)의 채널·DM 메시지 본문 검색 API. 서비스만 부른다(RLS 트랜잭션은 서비스가 연다). */
@Validated
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/search")
public class SearchMessageController {

  private final SearchMessageService service;

  /**
   * 호출자가 멤버인 채널·DM 의 메시지를 본문으로 찾는다(최신순). q 가 2자 미만이면 빈 결과. 다음 쪽은 이전 쪽 마지막 행의 createdAt·id 를
   * beforeAt·beforeId 로 넘긴다(createdAt 은 받은 문자열 그대로 — 마이크로초까지 맞아야 경계 행이 빠지지 않는다).
   */
  @GetMapping("/messages")
  public ResponseEntity<MessageSearchPage> messages(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "q", required = false) String q,
      @RequestParam(value = "beforeAt", required = false) Instant beforeAt,
      @RequestParam(value = "beforeId", required = false) Long beforeId,
      @RequestParam(value = "size", required = false, defaultValue = "20")
          @Min(value = 1, message = "size 는 1~50 이어야 합니다")
          @Max(value = 50, message = "size 는 1~50 이어야 합니다")
          int size) {
    return ResponseEntity.ok(service.search(callerId, q, beforeAt, beforeId, size));
  }
}
