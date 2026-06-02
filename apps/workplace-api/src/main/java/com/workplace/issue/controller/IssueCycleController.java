package com.workplace.issue.controller;

import com.workplace.cycle.dto.CycleSummary;
import com.workplace.global.security.RequirePermission;
import com.workplace.issue.service.IssueCycleService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 사이클 집합 조회/교체. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/cycles")
@RequiredArgsConstructor
public class IssueCycleController {

  private final IssueCycleService issueCycleService;

  /** 사이클 집합 교체 요청 본문. */
  public record ReplaceCyclesRequest(@NotNull List<Long> cycleIds) {}

  /** 이슈에 연결된 사이클 요약 목록. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<CycleSummary>> list(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    return ResponseEntity.ok(issueCycleService.list((Long) auth.getPrincipal(), key, number));
  }

  /** 사이클 집합 통째 교체 — 멤버 권한. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<List<CycleSummary>> replace(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ReplaceCyclesRequest req) {
    return ResponseEntity.ok(
        issueCycleService.replace((Long) auth.getPrincipal(), key, number, req.cycleIds()));
  }
}
