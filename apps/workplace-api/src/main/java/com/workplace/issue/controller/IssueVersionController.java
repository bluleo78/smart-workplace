package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueVersionsResponse;
import com.workplace.issue.dto.ReplaceVersionsRequest;
import com.workplace.issue.service.IssueVersionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 수정 버전·영향 버전 교체(WP-888) — 구성요소 교체와 같은 PUT 단일 엔드포인트, 같은 권한(issue:write + 프로젝트 멤버). */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/versions")
@RequiredArgsConstructor
public class IssueVersionController {

  private final IssueVersionService issueVersionService;

  /** 보낸 종류의 버전 집합을 통째로 교체하고, 교체 뒤 두 종류를 모두 돌려준다. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueVersionsResponse> replace(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ReplaceVersionsRequest req) {
    return ResponseEntity.ok(
        issueVersionService.replace((Long) auth.getPrincipal(), key, number, req));
  }
}
