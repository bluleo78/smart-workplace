package com.workplace.home.controller;

import com.workplace.global.security.InternalOnBehalfOf;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.AiMemoryListResponse;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.service.AiMemoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 본인 AI 메모리(WP-55) — 설정 화면 직접 관리와 ai-agent 메모리 도구(Internal 대행)가 같은 경로를 쓴다. 권한 체크 없음 — 누구나 자기 메모리만
 * 다룬다(AiPreferenceController 와 같은 self-service). 경로는 /users/me 아래지만 홈 채팅과 묶여 home 모듈에 둔다(판정 1).
 */
@RestController
@RequestMapping("/api/v1/users/me/ai-memories")
@RequiredArgsConstructor
public class AiMemoryController {

  private final AiMemoryService service;

  /** 목록(최신순 전부, 최대 50) + 상한. */
  @GetMapping
  public AiMemoryListResponse list(@AuthenticationPrincipal Long callerId) {
    return service.list(callerId);
  }

  /** 생성 — 201 + 항목. ai-agent 대행(Internal)이면 source:'AI'·세션을 받고 꺼짐이면 409(판정 2). */
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public AiMemoryItem create(
      @AuthenticationPrincipal Long callerId,
      @RequestBody CreateAiMemoryRequest req,
      Authentication authentication) {
    return service.create(callerId, req, InternalOnBehalfOf.isInternal(authentication));
  }

  /** 고치기 — 이전 내용 포함. 대행 + 꺼짐이면 409. */
  @PatchMapping("/{id}")
  public AiMemoryItem update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      @RequestBody UpdateAiMemoryRequest req,
      Authentication authentication) {
    return service.update(
        callerId, id, req.content(), req.kind(), InternalOnBehalfOf.isInternal(authentication));
  }

  /** 지우기 — 지운 항목(판정 12). 대행 + 꺼짐이면 409. */
  @DeleteMapping("/{id}")
  public AiMemoryItem delete(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      Authentication authentication) {
    return service.delete(callerId, id, InternalOnBehalfOf.isInternal(authentication));
  }

  /** 모두 지우기 — 204. */
  @DeleteMapping
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void clear(@AuthenticationPrincipal Long callerId) {
    service.clear(callerId);
  }
}
