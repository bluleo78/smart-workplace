package com.workplace.home.controller;

import com.workplace.home.dto.AiSuggestionRequest;
import com.workplace.home.dto.AiSuggestionResponse;
import com.workplace.home.service.AiSuggestionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 빈 대화 추천 질문(WP-139). 인증 사용자 본인 기준 — 별도 권한 없음(본인 대화에만 쓰인다). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/ai/suggestions")
public class AiSuggestionController {

  private final AiSuggestionService service;

  /** 빈 새 대화에 보일 추천 질문. 본문이 비면({}) 일반 추천. */
  @PostMapping
  public AiSuggestionResponse starter(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody AiSuggestionRequest request) {
    return service.starter(callerId, request.screenContext());
  }
}
