package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 타임라인 화살표용 — 프로젝트 전체의 이슈 의존 엣지 조회. 이슈 단위가 아닌 프로젝트 단위 경로라 {@link IssueDependencyController} 와 분리.
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/issue-dependencies")
@RequiredArgsConstructor
public class IssueDependencyEdgesController {

  private final ProjectAccessGuard accessGuard;
  private final IssueDependencyRepository dependencyRepository;

  /** from 이 to 를 차단(issue_id → blocks_issue_id)함을 의미하는 엣지. */
  public record DependencyEdgeResponse(int fromIssueNumber, int toIssueNumber) {}

  /**
   * 프로젝트 소속 이슈들의 의존 엣지를 전부 반환.
   *
   * <p>{@code @Transactional} 없으면 TenantAwareTransactionManager 가 GUC(app.tenant_id) 를 주입하지 않아
   * project 테이블 RLS 가 fail-closed 로 전 행을 가려 항상 404 가 났다.
   */
  @GetMapping
  @RequirePermission("project:read")
  @Transactional(readOnly = true)
  public ResponseEntity<List<DependencyEdgeResponse>> list(
      Authentication auth, @PathVariable String key) {
    Long callerId = (Long) auth.getPrincipal();
    var project = accessGuard.assertReadable(key, callerId);
    var edges =
        dependencyRepository.listEdgesByProject(project.id()).stream()
            .map(e -> new DependencyEdgeResponse(e.fromIssueNumber(), e.toIssueNumber()))
            .toList();
    return ResponseEntity.ok(edges);
  }
}
