package com.workplace.role.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.role.dto.*;
import com.workplace.role.service.RoleService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/roles")
@RequiredArgsConstructor
public class RoleController {

  private final RoleService roleService;

  @GetMapping
  @RequirePermission("role:read")
  public ResponseEntity<List<RoleResponse>> getAllRoles() {
    List<RoleResponse> roles = roleService.getAllRoles();
    return ResponseEntity.ok(roles);
  }

  @GetMapping("/{id}")
  @RequirePermission("role:read")
  public ResponseEntity<RoleDetailResponse> getRoleById(@PathVariable Long id) {
    RoleDetailResponse role = roleService.getRoleById(id);
    return ResponseEntity.ok(role);
  }

  @PostMapping
  @RequirePermission("role:write")
  public ResponseEntity<RoleResponse> createRole(
      Authentication authentication, @Valid @RequestBody CreateRoleRequest request) {
    RoleResponse role =
        roleService.createRole(
            request.name(), request.description(), (Long) authentication.getPrincipal());
    return ResponseEntity.status(HttpStatus.CREATED).body(role);
  }

  @PutMapping("/{id}")
  @RequirePermission("role:write")
  public ResponseEntity<Void> updateRole(
      Authentication authentication,
      @PathVariable Long id,
      @Valid @RequestBody UpdateRoleRequest request) {
    roleService.updateRole(
        id, request.name(), request.description(), (Long) authentication.getPrincipal());
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/{id}")
  @RequirePermission("role:delete")
  public ResponseEntity<Void> deleteRole(Authentication authentication, @PathVariable Long id) {
    roleService.deleteRole(id, (Long) authentication.getPrincipal());
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/{id}/permissions")
  @RequirePermission("role:write")
  public ResponseEntity<Void> setRolePermissions(
      Authentication authentication,
      @PathVariable Long id,
      @Valid @RequestBody SetPermissionsRequest request) {
    roleService.setRolePermissions(
        id, request.permissionIds(), (Long) authentication.getPrincipal());
    return ResponseEntity.noContent().build();
  }
}
