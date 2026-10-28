package com.workplace.project.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.project.dto.AddMemberGroupRequest;
import com.workplace.project.dto.ProjectMemberGroupResponse;
import com.workplace.project.service.ProjectMemberGroupService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프로젝트 멤버로 둔 조직도 부서 REST API(WP-1057). 권한은 사람 멤버 API({@link ProjectMemberController})와 같다 — 조회는
 * project:read·읽을 수 있는 사람, 변경은 project:manage·OWNER. 역할은 MEMBER 고정이라 역할 변경 API 는 없다.
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/member-groups")
@RequiredArgsConstructor
public class ProjectMemberGroupController {

  private final ProjectMemberGroupService service;

  /** 프로젝트 멤버 부서 목록(이름순, 부서마다 들어오는 사람 수). */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<ProjectMemberGroupResponse>> list(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(service.list((Long) auth.getPrincipal(), key));
  }

  /** 조직도 부서를 멤버로 더한다(역할 MEMBER). */
  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<ProjectMemberGroupResponse> add(
      Authentication auth,
      @PathVariable String key,
      @Valid @RequestBody AddMemberGroupRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.add((Long) auth.getPrincipal(), key, req.groupId(), req.role()));
  }

  /** 멤버 부서 제거 — 부서로만 들어와 있던 사람은 멤버 제거와 같이 정리된다. */
  @DeleteMapping("/{groupId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> remove(
      Authentication auth, @PathVariable String key, @PathVariable long groupId) {
    service.remove((Long) auth.getPrincipal(), key, groupId);
    return ResponseEntity.noContent().build();
  }
}
