package com.workplace.home.controller;

import com.workplace.home.dto.HomeActionConfirmRequest;
import com.workplace.home.service.HomeActionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** 확인 플로우 실행기 — 도크 확인 카드 승인을 받아 도메인 액션을 결정적으로 실행한다 (#333 M2). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home/actions")
public class HomeActionController {

  private final HomeActionService actionService;

  /** 확인 카드 승인 — actionType 으로 라우팅. 생성형 액션은 201, 결과 객체 반환. */
  @PostMapping("/confirm")
  public ResponseEntity<Object> confirm(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody HomeActionConfirmRequest request) {
    Object result = actionService.confirm(callerId, request.actionType(), request.params());
    return ResponseEntity.status(HttpStatus.CREATED).body(result);
  }
}
