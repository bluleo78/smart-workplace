package com.workplace.mail.controller;

import com.workplace.mail.dto.ConnectionTestResult;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.service.EmailAccountService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 개인 메일 계정 REST. 모든 엔드포인트는 @AuthenticationPrincipal callerId(=본인) 스코프 — 별도 권한 키 없이 본인 소유만 다룬다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail/accounts")
public class EmailAccountController {

  private final EmailAccountService service;

  /** 내 메일 계정 목록(비밀번호 제외). */
  @GetMapping
  public List<EmailAccountResponse> list(@AuthenticationPrincipal Long callerId) {
    return service.list(callerId);
  }

  /** 계정 등록 — 저장 전 연결 테스트 통과 필수(실패 시 MailExceptionHandler 가 400 + result). */
  @PostMapping
  public ResponseEntity<EmailAccountResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody EmailAccountRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(callerId, req));
  }

  /** 계정 수정(비밀번호 미입력 시 기존 유지). */
  @PutMapping("/{id}")
  public EmailAccountResponse update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody EmailAccountRequest req) {
    return service.update(callerId, id, req);
  }

  /** 계정 비활성화(soft delete). */
  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    service.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }

  /** 저장 없이 연결만 테스트(추가 폼). 비밀번호는 본문 값을 그대로 사용. */
  @PostMapping("/test")
  public ConnectionTestResult test(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody EmailAccountRequest req) {
    return service.test(req);
  }

  /**
   * 전역 개인 비서 사용 여부 — 사용자의 모든 활성 메일 계정을 일괄 변경한다.
   *
   * <p>프론트엔드의 "개인 비서 사용" 전역 토글에서 호출한다.
   */
  @PatchMapping("/ai-enabled")
  public ResponseEntity<Void> setAiEnabled(
      @AuthenticationPrincipal Long callerId, @RequestBody AiEnabledRequest req) {
    service.setAiEnabledForAll(callerId, req.aiEnabled());
    return ResponseEntity.noContent().build();
  }

  /** 전역 AI 설정 요청 DTO. */
  record AiEnabledRequest(boolean aiEnabled) {}

  /**
   * 기존 계정 연결 테스트(수정 폼) — 비밀번호 미입력 시 저장된 비밀번호로 폴백. 본인 소유 아니면 404. #448: 수정 폼은 비밀번호를 비워두므로 이 경로가 없으면
   * 인증 실패한다.
   */
  @PostMapping("/{id}/test")
  public ConnectionTestResult testExisting(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody EmailAccountRequest req) {
    return service.test(callerId, id, req);
  }
}
