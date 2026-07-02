package com.workplace.home.controller;

import com.workplace.home.dto.PriorityItemResponse;
import com.workplace.home.service.PriorityItemQueryService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** GET /api/v1/me/priority-items — 로그인 사용자의 최신 AI 우선순위 배치 결과. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/me/priority-items")
public class PriorityItemController {

  private final PriorityItemQueryService queryService;

  @GetMapping
  public PriorityItemsResponse list(@AuthenticationPrincipal Long callerId) {
    return new PriorityItemsResponse(queryService.listForUser(callerId));
  }

  /** 응답 래퍼. */
  public record PriorityItemsResponse(List<PriorityItemResponse> items) {}
}
