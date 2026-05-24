package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.service.IssueService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 부모(SUBTASK) 설정/해제 PATCH. parentNumber == null 이면 해제. 권한은 일반 이슈 변경과 동일한 issue:write. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/parent")
@RequiredArgsConstructor
public class IssueParentController {

  private final IssueService issueService;

  /** body — null 허용 (해제). */
  public record SetParentRequest(Integer parentNumber) {}

  /** SUBTASK 의 부모 설정/해제. */
  @PatchMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> set(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody SetParentRequest req) {
    return ResponseEntity.ok(
        issueService.setParent((Long) auth.getPrincipal(), key, number, req.parentNumber()));
  }
}
