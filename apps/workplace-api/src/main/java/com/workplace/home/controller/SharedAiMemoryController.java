package com.workplace.home.controller;

import com.workplace.global.security.InternalOnBehalfOf;
import com.workplace.home.dto.SaveSharedAiMemoryRequest;
import com.workplace.home.dto.SharedAiMemoryChangePage;
import com.workplace.home.dto.SharedAiMemoryItem;
import com.workplace.home.dto.SharedAiMemoryPage;
import com.workplace.home.dto.SharedAiMemoryRequestBody;
import com.workplace.home.dto.SharedAiMemoryRequestResult;
import com.workplace.home.dto.SharedMemorySpaceList;
import com.workplace.home.dto.UndoSharedAiMemoryChangeResponse;
import com.workplace.home.exception.SharedAiMemoryException;
import com.workplace.home.service.SharedAiMemoryChangeService;
import com.workplace.home.service.SharedAiMemoryRequestService;
import com.workplace.home.service.SharedAiMemoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 공용 AI 메모리 API(WP-386 스펙 7절). 사람은 설정 화면에서 읽고 쓰고, 에이전트(내부 토큰)는 읽기와 {@code /requests}(Task 8) 로만 쓴다
 * — 직접 쓰기 경로는 내부 토큰이면 403(공용성 검사를 건너뛰지 못하게, 조직 지침을 AI 가 바꾸지 못하게).
 */
@RestController
@RequestMapping("/api/v1/shared-ai-memories")
@RequiredArgsConstructor
public class SharedAiMemoryController {

  private final SharedAiMemoryService service;
  private final SharedAiMemoryChangeService changeService;
  private final SharedAiMemoryRequestService requestService;

  /** 내가 읽을 수 있는 공간(조직 → 프로젝트 → 노트 스페이스). */
  @GetMapping("/spaces")
  public SharedMemorySpaceList spaces(Authentication auth) {
    return service.spaces((Long) auth.getPrincipal());
  }

  /** 공간 목록·검색 — cursor·size=30, q 가 있으면 한 묶음. */
  @GetMapping
  public SharedAiMemoryPage list(
      Authentication auth,
      @RequestParam("spaceType") String spaceType,
      @RequestParam(value = "spaceId", required = false) Long spaceId,
      @RequestParam(value = "q", required = false) String q,
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "size", required = false) Integer size) {
    return service.list((Long) auth.getPrincipal(), spaceType, spaceId, q, cursor, size);
  }

  /** 직접 추가. */
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public SharedAiMemoryItem add(Authentication auth, @RequestBody SaveSharedAiMemoryRequest req) {
    requireHuman(auth);
    return service.add((Long) auth.getPrincipal(), req.spaceType(), req.spaceId(), req.content());
  }

  /** 고치기. */
  @PatchMapping("/{id}")
  public SharedAiMemoryItem update(
      Authentication auth,
      @PathVariable("id") long id,
      @RequestBody SaveSharedAiMemoryRequest req) {
    requireHuman(auth);
    return service.update((Long) auth.getPrincipal(), id, req.content());
  }

  /** 지우기. */
  @DeleteMapping("/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(Authentication auth, @PathVariable("id") long id) {
    requireHuman(auth);
    service.delete((Long) auth.getPrincipal(), id);
  }

  /** 공간 기록(최신순 묶음). 경로가 {@code /{id}} 보다 구체적이다. */
  @GetMapping("/changes")
  public SharedAiMemoryChangePage changes(
      Authentication auth,
      @RequestParam("spaceType") String spaceType,
      @RequestParam(value = "spaceId", required = false) Long spaceId,
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "size", required = false) Integer size) {
    return changeService.list((Long) auth.getPrincipal(), spaceType, spaceId, cursor, size);
  }

  /** 기록 하나 되돌리기 — 관리 권한자, 또는 본인 항목의 본인 기록. 에이전트 대행(내부 토큰)은 403. */
  @PostMapping("/changes/{id}/undo")
  public UndoSharedAiMemoryChangeResponse undo(Authentication auth, @PathVariable("id") long id) {
    requireHuman(auth);
    return changeService.undo((Long) auth.getPrincipal(), id);
  }

  /**
   * 에이전트 직접 요청(스펙 6.2) — 내부 토큰 전용(사람이 부르면 403). 요청한 사람은 대행 토큰이 정한 사용자이고 본문의 사용자 id 는 받지 않는다. 공용성
   * 검사를 동기로 마친 뒤 저장한다.
   */
  @PostMapping("/requests")
  @ResponseStatus(HttpStatus.CREATED)
  public SharedAiMemoryRequestResult request(
      Authentication auth, @RequestBody SharedAiMemoryRequestBody body) {
    if (!InternalOnBehalfOf.isInternal(auth)) {
      throw SharedAiMemoryException.forbidden("이 경로는 AI 비서 전용이에요.");
    }
    return requestService.request((Long) auth.getPrincipal(), body);
  }

  /** 에이전트 내부 토큰이면 403. */
  private static void requireHuman(Authentication auth) {
    if (InternalOnBehalfOf.isInternal(auth)) {
      throw SharedAiMemoryException.forbidden("AI 는 공용 메모리를 직접 바꾸지 않아요.");
    }
  }
}
