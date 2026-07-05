package com.workplace.user.controller;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.RequirePermission;
import com.workplace.user.dto.*;
import com.workplace.user.service.UserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

/** 사용자 REST API. @Validated 로 쿼리 파라미터 Bean Validation 활성화. */
@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
@Validated
public class UserController {

  private final UserService userService;

  /**
   * 구성원(계정) 추가 — 테넌트 ADMIN 셀프서비스.
   *
   * <p>생성=user:write + 역할부여=role:assign 두 권한을 모두 요구한다(둘 다 필요). user:write 만으로 ADMIN 역할 구성원을 만들어내는
   * 권한 상승을 막기 위함. callerId 는 감사 로그용으로 서비스에 전달.
   */
  @PostMapping
  @RequirePermission({"user:write", "role:assign"})
  public ResponseEntity<MemberResponse> createMember(
      Authentication authentication, @Valid @RequestBody CreateMemberRequest req) {
    Long callerId = (Long) authentication.getPrincipal();
    MemberResponse created = userService.createMember(req, callerId);
    return ResponseEntity.status(HttpStatus.CREATED).body(created);
  }

  @GetMapping("/me")
  public ResponseEntity<UserDetailResponse> getMyProfile(Authentication authentication) {
    Long userId = (Long) authentication.getPrincipal();
    UserDetailResponse user = userService.getUserById(userId);
    return ResponseEntity.ok(user);
  }

  @PutMapping("/me")
  @RequirePermission("user:write:self")
  public ResponseEntity<Void> updateMyProfile(
      Authentication authentication, @Valid @RequestBody UpdateProfileRequest request) {
    Long userId = (Long) authentication.getPrincipal();
    userService.updateProfile(userId, request.name(), request.email());
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/me/password")
  @RequirePermission("user:write:self")
  public ResponseEntity<Void> changeMyPassword(
      Authentication authentication, @Valid @RequestBody ChangePasswordRequest request) {
    Long userId = (Long) authentication.getPrincipal();
    userService.changePassword(userId, request.currentPassword(), request.newPassword());
    return ResponseEntity.noContent().build();
  }

  /**
   * 사용자 목록/검색. {@code kind} 미지정 시 HUMAN 만 노출(설정 > 사용자 관리 기존 동작 유지). DM 수신자 검색·멘션 등 에이전트를 포함해야 하는
   * 화면은 {@code kind=AGENT} 또는 {@code kind=ALL} 을 명시적으로 넘긴다(#691).
   */
  @GetMapping
  @RequirePermission("user:read")
  public ResponseEntity<PageResponse<UserResponse>> getUsers(
      @RequestParam(required = false) String search,
      @Min(value = 0, message = "page는 0 이상이어야 합니다") @RequestParam(defaultValue = "0") int page,
      @Min(value = 1, message = "size는 1 이상이어야 합니다") @RequestParam(defaultValue = "20") int size,
      @jakarta.validation.constraints.Pattern(
              regexp = "HUMAN|AGENT|ALL",
              message = "kind는 HUMAN, AGENT, ALL 중 하나여야 합니다")
          @RequestParam(defaultValue = "HUMAN")
          String kind) {
    PageResponse<UserResponse> users = userService.getUsers(search, page, size, kind);
    return ResponseEntity.ok(users);
  }

  @GetMapping("/{id}")
  @RequirePermission("user:read")
  public ResponseEntity<UserDetailResponse> getUserById(@PathVariable Long id) {
    UserDetailResponse user = userService.getUserById(id);
    return ResponseEntity.ok(user);
  }

  @PutMapping("/{id}/roles")
  @RequirePermission("role:assign")
  public ResponseEntity<Void> setUserRoles(
      Authentication authentication,
      @PathVariable Long id,
      @Valid @RequestBody SetRolesRequest request) {
    Long callerId = (Long) authentication.getPrincipal();
    userService.setUserRoles(id, request.roleIds(), callerId);
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/{id}/active")
  @RequirePermission("user:write")
  public ResponseEntity<Void> setUserActive(
      @PathVariable Long id, @Valid @RequestBody SetActiveRequest request) {
    userService.setUserActive(id, request.active());
    return ResponseEntity.noContent().build();
  }
}
