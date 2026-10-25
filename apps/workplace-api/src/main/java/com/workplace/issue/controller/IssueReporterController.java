package com.workplace.issue.controller;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.security.RequirePermission;
import com.workplace.issue.service.IssueReporterService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 보고자 바꾸기(WP-944) — 담당자처럼 별도 PUT. 누가 바꿀 수 있는지는 서비스(IssueReporterService)가 정한다. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/reporter")
@RequiredArgsConstructor
public class IssueReporterController {

  private final IssueReporterService service;

  /** 보고자 변경 요청 본문. */
  public record ChangeReporterRequest(@NotNull Long userId) {}

  /** 보고자를 바꾸고 새 보고자 요약을 돌려준다. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<UserSummary> change(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ChangeReporterRequest req) {
    return ResponseEntity.ok(service.change((Long) auth.getPrincipal(), key, number, req.userId()));
  }
}
