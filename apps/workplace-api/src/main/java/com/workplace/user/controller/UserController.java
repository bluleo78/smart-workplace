package com.workplace.user.controller;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.RequirePermission;
import com.workplace.user.dto.*;
import com.workplace.user.service.UserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
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

  @GetMapping
  @RequirePermission("user:read")
  public ResponseEntity<PageResponse<UserResponse>> getUsers(
      @RequestParam(required = false) String search,
      @Min(value = 0, message = "page는 0 이상이어야 합니다") @RequestParam(defaultValue = "0") int page,
      @Min(value = 1, message = "size는 1 이상이어야 합니다") @RequestParam(defaultValue = "20") int size) {
    PageResponse<UserResponse> users = userService.getUsers(search, page, size);
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
