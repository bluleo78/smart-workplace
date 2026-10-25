package com.workplace.issue.controller;

import com.workplace.issue.dto.IssueRelationTypeResponse;
import com.workplace.issue.service.IssueRelationTypeService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이슈 관계 유형 목록(WP-887) — 관계 추가 창·이슈 상세가 말을 그리려고 부른다. 권한 코드 없이 로그인만 하면 된다(관리는 {@link
 * IssueRelationTypeAdminController}).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/issue-relation-types")
public class IssueRelationTypeController {

  private final IssueRelationTypeService service;

  /** 유형 목록 — 숨김 여부·코드·말 포함, 정렬값 순. */
  @GetMapping
  public ResponseEntity<List<IssueRelationTypeResponse>> list() {
    return ResponseEntity.ok(service.list());
  }
}
