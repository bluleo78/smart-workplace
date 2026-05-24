package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.service.IssueDependencyService;
import com.workplace.issue.service.IssueService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 의존성 add/remove 엔드포인트 — POST 응답은 갱신된 IssueDetailResponse, DELETE 는 204. (Phase 4b) */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/dependencies")
@RequiredArgsConstructor
public class IssueDependencyController {

  private final IssueDependencyService depService;
  private final IssueService issueService;

  /** body — otherNumber + direction("blocks"|"blockedBy") 필수. */
  public record AddDependencyRequest(@NotNull Integer otherNumber, @NotNull String direction) {}

  /** 의존성 1건 추가. 사이클이면 409, 자기/없는 이슈는 400. 성공 시 호출 이슈의 갱신된 상세 반환. */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> add(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody AddDependencyRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    depService.add(callerId, key, number, req.otherNumber(), req.direction());
    return ResponseEntity.ok(issueService.get(callerId, key, number));
  }

  /** 의존성 1건 제거 — 멱등(없으면 0건 삭제). */
  @DeleteMapping
  @RequirePermission("issue:write")
  public ResponseEntity<Void> remove(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @RequestParam Integer otherNumber,
      @RequestParam String direction) {
    Long callerId = (Long) auth.getPrincipal();
    depService.remove(callerId, key, number, otherNumber, direction);
    return ResponseEntity.noContent().build();
  }
}
