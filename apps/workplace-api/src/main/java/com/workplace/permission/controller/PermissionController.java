package com.workplace.permission.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.service.PermissionService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/permissions")
@RequiredArgsConstructor
public class PermissionController {

  private final PermissionService permissionService;

  @GetMapping
  @RequirePermission("permission:read")
  public ResponseEntity<List<PermissionResponse>> getPermissions(
      @RequestParam(required = false) String category) {
    List<PermissionResponse> permissions;
    if (category != null && !category.isBlank()) {
      permissions = permissionService.getPermissionsByCategory(category);
    } else {
      permissions = permissionService.getAllPermissions();
    }
    return ResponseEntity.ok(permissions);
  }
}
