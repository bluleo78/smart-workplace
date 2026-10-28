package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueRecurrenceRequest;
import com.workplace.issue.dto.IssueRecurrenceResponse;
import com.workplace.issue.service.IssueRecurrenceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 개인 작업의 반복 AI 작업(WP-989) — 이슈 하나의 반복 규칙 조회·저장·삭제. 저장·삭제는 이슈 수정과 같은 권한(issue:write + 프로젝트 멤버 — 개인
 * 프로젝트는 소유자만)이다.
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/recurrence")
@RequiredArgsConstructor
public class IssueRecurrenceController {

  private final IssueRecurrenceService recurrenceService;

  /** GET — 반복이 있으면 200, 없으면 204. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<IssueRecurrenceResponse> get(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    return recurrenceService
        .get((Long) auth.getPrincipal(), key, number)
        .map(ResponseEntity::ok)
        .orElseGet(() -> ResponseEntity.noContent().build());
  }

  /** PUT {rrule, time} — 저장(없으면 만들고, 꺼진 반복은 다시 켠다). */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueRecurrenceResponse> save(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @RequestBody(required = false) IssueRecurrenceRequest req) {
    return ResponseEntity.ok(recurrenceService.save((Long) auth.getPrincipal(), key, number, req));
  }

  /** DELETE — 반복을 지우고 그 AI 의 진행 중 작업을 취소한다(없어도 204). */
  @DeleteMapping
  @RequirePermission("issue:write")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    recurrenceService.delete((Long) auth.getPrincipal(), key, number);
    return ResponseEntity.noContent().build();
  }
}
