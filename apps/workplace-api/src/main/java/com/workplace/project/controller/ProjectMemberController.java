package com.workplace.project.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.MemberResponse;
import com.workplace.project.dto.UpdateMemberRoleRequest;
import com.workplace.project.service.ProjectService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 프로젝트 멤버십 REST API. */
@RestController
@RequestMapping("/api/v1/projects/{key}/members")
@RequiredArgsConstructor
public class ProjectMemberController {

  private final ProjectService projectService;

  /** 프로젝트 멤버 목록 조회. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<MemberResponse>> list(Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(projectService.listMembers((Long) auth.getPrincipal(), key));
  }

  /** 멤버 추가. OWNER 필요. */
  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<MemberResponse> add(
      Authentication auth, @PathVariable String key, @Valid @RequestBody AddMemberRequest req) {
    return ResponseEntity.ok(projectService.addMember((Long) auth.getPrincipal(), key, req));
  }

  /** 멤버 역할 변경. OWNER 필요. */
  @PatchMapping("/{userId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> updateRole(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long userId,
      @Valid @RequestBody UpdateMemberRoleRequest req) {
    projectService.updateMemberRole((Long) auth.getPrincipal(), key, userId, req);
    return ResponseEntity.noContent().build();
  }

  /** 멤버 제거. OWNER 필요. */
  @DeleteMapping("/{userId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> remove(
      Authentication auth, @PathVariable String key, @PathVariable Long userId) {
    projectService.removeMember((Long) auth.getPrincipal(), key, userId);
    return ResponseEntity.noContent().build();
  }
}
