package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.AddIssueRelationRequest;
import com.workplace.issue.dto.IssueRelationView;
import com.workplace.issue.service.IssueRelationService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이슈 사이 관계 걸기·지우기(WP-887) — 관련·중복·복제·원인과 사용자 정의 유형을 다른 프로젝트 이슈까지 건다. 차단은 의존성 API ({@code
 * …/dependencies})가 그대로 맡는다. 권한(주소 이슈 멤버 + 상대 읽기)은 서비스가 본다.
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/relations")
@RequiredArgsConstructor
public class IssueRelationController {

  private final IssueRelationService relationService;

  /** 관계 한 줄 걸기 — 같은 관계가 이미 있으면 그대로 200. 응답은 이 이슈 기준 갱신된 관계 목록. */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<List<IssueRelationView>> add(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody AddIssueRelationRequest req) {
    return ResponseEntity.ok(relationService.add((Long) auth.getPrincipal(), key, number, req));
  }

  /** 관계 한 줄 지우기 — 없거나 이 이슈의 관계가 아니면 아무것도 하지 않고 204(멱등). */
  @DeleteMapping("/{relationId}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> remove(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable long relationId) {
    relationService.remove((Long) auth.getPrincipal(), key, number, relationId);
    return ResponseEntity.noContent().build();
  }
}
