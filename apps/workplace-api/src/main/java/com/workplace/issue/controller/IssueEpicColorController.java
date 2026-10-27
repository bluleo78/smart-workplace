package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.service.IssueEpicColorService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 에픽 색 바꾸기(WP-1017) — 보고자처럼 별도 PUT. 에픽인지·누가 바꿀 수 있는지는 서비스(IssueEpicColorService)가 정한다. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/epic-color")
@RequiredArgsConstructor
public class IssueEpicColorController {

  private final IssueEpicColorService service;

  /** 에픽 색 변경 요청 본문 — 라벨과 같은 12색 토큰(GRAY·RED …). */
  public record ChangeEpicColorRequest(@NotBlank String colorToken) {}

  /** 에픽 색 변경 응답 — 저장된 토큰. */
  public record EpicColorResponse(String colorToken) {}

  /** 에픽 색을 바꾸고 저장된 토큰을 돌려준다. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<EpicColorResponse> change(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ChangeEpicColorRequest req) {
    return ResponseEntity.ok(
        new EpicColorResponse(
            service.change((Long) auth.getPrincipal(), key, number, req.colorToken())));
  }
}
