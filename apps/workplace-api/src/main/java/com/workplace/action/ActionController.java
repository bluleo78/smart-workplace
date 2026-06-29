package com.workplace.action;

import com.workplace.action.dto.ActionConfirmRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 공용 cross-app 확인 카드 승인 엔드포인트 — actionType 으로 라우팅(home/wiki/messaging 공유). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/actions")
public class ActionController {

  private final ActionService actionService;

  /** 확인 카드 승인 — 생성형 액션은 201, 결과 객체 반환. */
  @PostMapping("/confirm")
  public ResponseEntity<Object> confirm(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody ActionConfirmRequest request) {
    Object result = actionService.confirm(callerId, request.actionType(), request.params());
    return ResponseEntity.status(HttpStatus.CREATED).body(result);
  }
}
