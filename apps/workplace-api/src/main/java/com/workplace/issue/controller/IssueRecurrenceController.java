package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueRecurrenceAgentOption;
import com.workplace.issue.dto.IssueRecurrenceRequest;
import com.workplace.issue.dto.IssueRecurrenceResponse;
import com.workplace.issue.service.IssueRecurrenceService;
import java.util.List;
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
 * 이슈의 반복 AI 작업(WP-989, 「실행 일정」) — 이슈 하나의 반복 규칙 조회·저장·삭제와 담당 AI 후보(WP-1314). 저장·삭제는 이슈 수정과 같은
 * 권한(issue:write + 프로젝트 멤버 — 개인 프로젝트는 소유자만)이고, 담당 AI 가 남의 개인 비서인 일정은 그 주인만(403) 바꾼다.
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

  /** GET agents — 이 이슈의 실행 일정에 담당으로 고를 수 있는 AI(서버 실행 AI, 남의 개인 비서 제외). */
  @GetMapping("/agents")
  @RequirePermission("project:read")
  public List<IssueRecurrenceAgentOption> agents(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    return recurrenceService.agentOptions((Long) auth.getPrincipal(), key, number);
  }

  /** PUT {rrule, time, agentUserId?} — 저장(없으면 만들고, 꺼진 반복은 다시 켠다). */
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
