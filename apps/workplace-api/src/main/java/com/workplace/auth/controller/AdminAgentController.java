package com.workplace.auth.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.service.UserService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Phase 5a — ADMIN 의 AGENT 유저 CRUD. user:write 권한이 필요하다 (ADMIN 만 보유). */
@RestController
@RequestMapping("/api/v1/admin/agents")
@RequiredArgsConstructor
public class AdminAgentController {

  private final UserService userService;

  /** AGENT 목록. */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<List<UserResponse>> list() {
    return ResponseEntity.ok(userService.listByKind(UserKind.AGENT));
  }

  /** AGENT 생성. */
  @PostMapping
  @RequirePermission("user:write")
  public ResponseEntity<UserResponse> create(
      Authentication auth, @Valid @RequestBody CreateAgentRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    return ResponseEntity.ok(userService.createAgent(callerId, req));
  }

  /** AGENT 삭제 (CASCADE 로 키도 함께 제거). */
  @DeleteMapping("/{userId}")
  @RequirePermission("user:write")
  public ResponseEntity<Void> delete(Authentication auth, @PathVariable Long userId) {
    Long callerId = (Long) auth.getPrincipal();
    userService.deleteAgent(callerId, userId);
    return ResponseEntity.noContent().build();
  }
}
