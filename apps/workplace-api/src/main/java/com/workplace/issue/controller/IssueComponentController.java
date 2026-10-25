package com.workplace.issue.controller;

import com.workplace.component.dto.ComponentSummary;
import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.ReplaceComponentsRequest;
import com.workplace.issue.service.IssueComponentService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 구성요소 집합 교체(WP-933) — 라벨 교체와 같은 PUT 단일 엔드포인트, 같은 권한(issue:write + 프로젝트 멤버). */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/components")
@RequiredArgsConstructor
public class IssueComponentController {

  private final IssueComponentService issueComponentService;

  /** 구성요소 집합을 통째로 교체하고, 교체 뒤 구성요소(목록 순서)를 돌려준다. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<List<ComponentSummary>> replace(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ReplaceComponentsRequest req) {
    return ResponseEntity.ok(
        issueComponentService.replace((Long) auth.getPrincipal(), key, number, req.componentIds()));
  }
}
