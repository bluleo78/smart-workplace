package com.workplace.user.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.user.dto.AddMemberRequest;
import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.user.dto.UserGroupDetail;
import com.workplace.user.dto.UserGroupTreeResponse;
import com.workplace.user.service.UserGroupService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 사용자 그룹·조직도 API. 조회는 contact:read(클래스 레벨). 쓰기 권한은 서비스에서 visibility 별로 판정 (PERSONAL=본인,
 * SHARED=user-group:manage) — 개인 그룹은 contact:read 사용자가 생성 가능해야 하므로 메서드 레벨 권한을 두지 않는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/user-groups")
@RequirePermission("contact:read")
public class UserGroupController {
  private final UserGroupService service;

  /** 공유 조직도 + 내 개인 그룹 트리. */
  @GetMapping
  public ResponseEntity<UserGroupTreeResponse> tree(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.getTree(callerId));
  }

  /** 그룹 상세 + 직속 멤버. */
  @GetMapping("/{id}")
  public ResponseEntity<UserGroupDetail> detail(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long id) {
    return ResponseEntity.ok(service.getDetail(callerId, id));
  }

  /** 그룹 생성. */
  @PostMapping
  public ResponseEntity<UserGroupDetail> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateUserGroupRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(callerId, req));
  }

  /** 그룹 수정. */
  @PatchMapping("/{id}")
  public ResponseEntity<UserGroupDetail> update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      @Valid @RequestBody UpdateUserGroupRequest req) {
    return ResponseEntity.ok(service.update(callerId, id, req));
  }

  /** 그룹 삭제. */
  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long id) {
    service.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }

  /** 멤버 편입. */
  @PostMapping("/{id}/members")
  public ResponseEntity<UserGroupDetail> addMember(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      @Valid @RequestBody AddMemberRequest req) {
    return ResponseEntity.ok(service.addMember(callerId, id, req));
  }

  /** 멤버 제외. */
  @DeleteMapping("/{id}/members/{targetType}/{targetId}")
  public ResponseEntity<Void> removeMember(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      @PathVariable("targetType") String targetType,
      @PathVariable("targetId") long targetId) {
    service.removeMember(callerId, id, targetType, targetId);
    return ResponseEntity.noContent().build();
  }
}
