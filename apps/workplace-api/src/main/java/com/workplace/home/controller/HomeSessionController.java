package com.workplace.home.controller;

import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.service.HomeSessionService;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 홈 AI Chat 세션 — 목록/생성/복원/삭제. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home/sessions")
public class HomeSessionController {
  private final HomeSessionService sessionService;

  /** 새 세션 생성. */
  @PostMapping
  public ResponseEntity<HomeSessionResponse> create(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.status(HttpStatus.CREATED).body(sessionService.create(callerId));
  }

  /** 세션 목록 조회 (커서 페이징). */
  @GetMapping
  public HomeSessionService.Page list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "30") int size) {
    return sessionService.list(callerId, cursor, size);
  }

  /** 세션 메시지 목록 조회. */
  @GetMapping("/{id}/messages")
  public List<HomeMessageResponse> messages(
      @AuthenticationPrincipal Long callerId, @PathVariable UUID id) {
    return sessionService.getMessages(callerId, id);
  }

  /** 세션 삭제. */
  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable UUID id) {
    sessionService.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }
}
