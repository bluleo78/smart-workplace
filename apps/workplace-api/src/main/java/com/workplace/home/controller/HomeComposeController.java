package com.workplace.home.controller;

import com.workplace.home.dto.HomeComposeRequest;
import com.workplace.home.dto.HomeComposeResponse;
import com.workplace.home.service.HomeComposeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 홈 컴포즈 — 자연어 명령을 위젯 레이아웃 스펙으로 (7b). 인증 필요(본인 세션). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home/compose")
public class HomeComposeController {

  private final HomeComposeService composeService;

  /** sessionId 미지정 시 새 세션 생성. AI 실행 + user/assistant 메시지 영속 후 결과 반환. */
  @PostMapping
  public HomeComposeResponse compose(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody HomeComposeRequest request) {
    return composeService.compose(callerId, request.sessionId(), request.query());
  }
}
