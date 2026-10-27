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

/**
 * 이슈 부모 설정/해제 PATCH. parentNumber·parentKey 가 모두 null 이면 해제. 권한은 일반 이슈 변경과 동일한 issue:write.
 * parentKey 로 다른 프로젝트의 에픽을 부모로 둘 수 있다(WP-1038 — 일반 이슈만, 그 에픽 프로젝트를 읽을 수 있어야 한다).
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/parent")
@RequiredArgsConstructor
public class IssueParentController {

  private final IssueService issueService;

  /**
   * body — 둘 다 null 이면 해제. parentKey(예: PLAN-12)는 다른 프로젝트 에픽 지정용(WP-1038), parentNumber 와 함께 오면 같은
   * 이슈여야 한다.
   */
  public record SetParentRequest(
      Integer parentNumber, @jakarta.validation.constraints.Size(max = 64) String parentKey) {

    /** 부모 키 없이 번호만 받는 기존 호환 생성자. */
    public SetParentRequest(Integer parentNumber) {
      this(parentNumber, null);
    }
  }

  /** SUBTASK 의 부모 설정/해제. */
  @PatchMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> set(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody SetParentRequest req) {
    return ResponseEntity.ok(
        issueService.setParent(
            (Long) auth.getPrincipal(), key, number, req.parentNumber(), req.parentKey()));
  }
}
