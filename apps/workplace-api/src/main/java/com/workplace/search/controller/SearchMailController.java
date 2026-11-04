package com.workplace.search.controller;

import com.workplace.mail.dto.MailListCursor;
import com.workplace.search.dto.MailSearchPage;
import com.workplace.search.service.SearchMailService;
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

/** 통합 검색 팔레트(WP-1359)의 메일 검색 API. 서비스만 부른다(RLS 트랜잭션은 서비스가 연다). */
@Validated
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/search")
public class SearchMailController {

  private final SearchMailService service;

  /**
   * 호출자의 모든 메일 계정에서 휴지통·스팸·임시보관함을 뺀 모든 메일함을 찾는다. q 가 2자 미만이면 빈 결과. 다음 쪽은 앞 쪽 마지막 항목의 (receivedAt,
   * id) 를 beforeAt·beforeId 로 넘긴다(메일함 목록 커서와 같다).
   */
  @GetMapping("/mail")
  public ResponseEntity<MailSearchPage> mail(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "q", required = false) String q,
      @RequestParam(value = "beforeAt", required = false) Instant beforeAt,
      @RequestParam(value = "beforeId", required = false) Long beforeId,
      @RequestParam(value = "size", required = false, defaultValue = "20")
          @Min(value = 1, message = "size 는 1~50 이어야 합니다")
          @Max(value = 50, message = "size 는 1~50 이어야 합니다")
          int size) {
    // beforeId 가 없으면 첫 쪽 — 수신 시각이 없는 행 구간의 커서는 beforeAt 없이 beforeId 만 온다.
    MailListCursor cursor = beforeId == null ? null : new MailListCursor(beforeAt, beforeId);
    return ResponseEntity.ok(service.search(callerId, q, cursor, size));
  }
}
