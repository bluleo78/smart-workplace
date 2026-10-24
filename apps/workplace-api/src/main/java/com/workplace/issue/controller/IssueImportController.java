package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.ImportIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.service.IssueImportService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이슈 가져오기 API(WP-883·884) — 이관 스크립트가 다른 트래커의 이슈를 원작성자·원시각으로, 알림 없이 한 건씩 넣는다. 관리자(사람) 판정은 서비스가 한다 —
 * 사유 코드(IMPORT_ADMIN_ONLY)를 실어 스크립트가 원인을 알 수 있게.
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/import/issues")
@RequiredArgsConstructor
public class IssueImportController {

  private final IssueImportService service;

  /** 이슈 한 건 가져오기. 성공 201 + 만든 이슈. */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueResponse> importIssue(
      Authentication auth, @PathVariable String key, @Valid @RequestBody ImportIssueRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.importIssue((Long) auth.getPrincipal(), key, req));
  }
}
