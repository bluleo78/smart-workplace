package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.ClaimIssueRequest;
import com.workplace.issue.dto.ClaimIssueResponse;
import com.workplace.issue.service.IssueClaimService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 라벨 대기열 이슈 가져가기(WP-800) — AI 구성원이 한 동작으로 담당 추가 + 대기열 라벨 제거. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/claim")
@RequiredArgsConstructor
public class IssueClaimController {

  private final IssueClaimService service;

  /** 이슈를 호출 AI 의 담당으로 가져오고, 가져간 뒤의 담당자·라벨을 돌려준다. 조건 불충족이면 409(errors.code). */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<ClaimIssueResponse> claim(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ClaimIssueRequest req) {
    return ResponseEntity.ok(
        service.claim((Long) auth.getPrincipal(), key, number, req.queueLabel()));
  }
}
