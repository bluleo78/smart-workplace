package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.UpdateIssueFieldsRequest;
import com.workplace.issue.service.IssueFieldValueService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Phase 4c — 이슈별 custom field 값 집합 변경. 멤버(issue:write). incoming 만 처리하며 null 값은 row 삭제. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/fields")
@RequiredArgsConstructor
public class IssueFieldValueController {

  private final IssueFieldValueService service;

  /** 값 집합 변경 PUT. 응답은 갱신된 이슈 상세. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> replace(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody UpdateIssueFieldsRequest req) {
    return ResponseEntity.ok(service.replace((Long) auth.getPrincipal(), key, number, req));
  }
}
