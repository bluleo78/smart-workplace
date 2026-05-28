package com.workplace.issue.controller;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.security.RequirePermission;
import com.workplace.issue.service.IssueAssigneeService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 담당자 집합 교체 — PUT 단일 엔드포인트. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/assignees")
@RequiredArgsConstructor
public class IssueAssigneeController {

  private final IssueAssigneeService service;

  /** 담당자 집합 교체 요청 본문. */
  public record ReplaceAssigneesRequest(@NotNull List<Long> userIds) {}

  /** 담당자 집합을 통째로 교체하고 갱신 후의 담당자 요약 리스트를 반환한다. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<List<UserSummary>> replace(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ReplaceAssigneesRequest req) {
    return ResponseEntity.ok(
        service.replace((Long) auth.getPrincipal(), key, number, req.userIds()));
  }
}
