package com.workplace.home.controller;

import com.workplace.global.security.InternalOnBehalfOf;
import com.workplace.home.dto.AiMemoryChangePage;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.AiMemoryListResponse;
import com.workplace.home.dto.AiMemorySearchResponse;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.dto.PinAiMemoryRequest;
import com.workplace.home.dto.UndoAiMemoryChangeResponse;
import com.workplace.home.dto.UndoAiMemoryRequest;
import com.workplace.home.dto.UndoAiMemoryResponse;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.service.AiMemoryChangeService;
import com.workplace.home.service.AiMemoryService;
import com.workplace.home.service.AiMemoryUndoService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
  private final AiMemoryUndoService undoService;
  private final AiMemoryChangeService changeService;

  /** 목록(최신순 전부) + 범위 상한·고정 상한. */
  @GetMapping
  public AiMemoryListResponse list(@AuthenticationPrincipal Long callerId) {
    return service.list(callerId);
  }

  /**
   * 검색(WP-383 search_memory) — 본인 유효 메모리 중 질의와 관련 있는 것. 꺼짐이면 memoryEnabled=false + 빈 목록. 사용자·대행 모두
   * 쓸 수 있다(읽기). 경로가 {@code /{id}} 보다 구체적이라 PATCH·DELETE {@code /{id}} 와 겹치지 않는다.
   */
  @GetMapping("/search")
  public AiMemorySearchResponse search(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "q", required = false) String q,
      @RequestParam(value = "scope", required = false) String scope,
      @RequestParam(value = "limit", required = false) Integer limit) {
    return service.search(callerId, q, scope, limit);
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

  /** 고치기 — 이전 내용·종류·범위 포함. scope 는 present-flag(키가 있으면 적용, null = 공통). 대행 + 꺼짐이면 409. */
  @PatchMapping("/{id}")
  public AiMemoryItem update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      @RequestBody UpdateAiMemoryRequest req,
      Authentication authentication) {
    return service.update(callerId, id, req, InternalOnBehalfOf.isInternal(authentication));
  }

  /** 지우기 — 지운 항목(판정 12). 대행 + 꺼짐이면 409. */
  @DeleteMapping("/{id}")
  public AiMemoryItem delete(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      Authentication authentication) {
    return service.delete(callerId, id, InternalOnBehalfOf.isInternal(authentication));
  }

  /** 고정 켜기·끄기(WP-383) — 사용자 전용(Internal 대행이면 403). updated_at 은 그대로라 최신순이 바뀌지 않는다. */
  @PutMapping("/{id}/pin")
  public AiMemoryItem pin(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      @RequestBody PinAiMemoryRequest req,
      Authentication authentication) {
    return service.setPinned(
        callerId, id, req.pinned(), InternalOnBehalfOf.isInternal(authentication));
  }

  /** 모두 지우기 — 204. */
  @DeleteMapping
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void clear(@AuthenticationPrincipal Long callerId) {
    service.clear(callerId);
  }

  /** 채팅 결과 줄 되돌리기(WP-55 §6) — 꺼짐이어도 허용. blockIndex 는 그 메시지의 memory 블록 순번(판정 4). */
  @PostMapping("/undo")
  public UndoAiMemoryResponse undo(
      @AuthenticationPrincipal Long callerId, @RequestBody UndoAiMemoryRequest req) {
    return undoService.undo(callerId, req);
  }

  /**
   * 「AI가 정리한 기록」(WP-385) — 최신순 묶음(cursor·size=30) + 지난 30일 횟수. 경로가 {@code /{id}} 보다 구체적이라 겹치지 않는다.
   */
  @GetMapping("/changes")
  public AiMemoryChangePage changes(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "size", required = false) Integer size) {
    return changeService.list(callerId, cursor, size);
  }

  /**
   * 기록 하나 되돌리기(WP-385) — 본인 것만, 사용자 전용(Internal 대행이면 403 AI_MEMORY_CHANGE_USER_ONLY — 고정과 같은 방식).
   * 409 AI_MEMORY_CHANGED(그 뒤 바뀜)·AI_MEMORY_CHANGE_UNDONE(이미 되돌림).
   */
  @PostMapping("/changes/{id}/undo")
  public UndoAiMemoryChangeResponse undoChange(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      Authentication authentication) {
    return changeService.undo(callerId, id, InternalOnBehalfOf.isInternal(authentication));
  }
}
