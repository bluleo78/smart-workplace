package com.workplace.auth.sso;

import com.workplace.auth.sso.dto.SsoSettingsResponse;
import com.workplace.auth.sso.dto.UpdateSsoEnabledRequest;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** WP-48 워크스페이스 관리자용 SSO 설정. */
@RestController
@RequestMapping("/api/v1/admin/sso")
@RequiredArgsConstructor
@RequirePermission("sso:manage")
public class SsoAdminController {

  private final SsoSettingsService service;

  @GetMapping
  public SsoSettingsResponse get() {
    return service.get();
  }

  @PutMapping("/enabled")
  public ResponseEntity<Void> setEnabled(
      Authentication authentication, @Valid @RequestBody UpdateSsoEnabledRequest req) {
    service.setEnabled(req.enabled(), (Long) authentication.getPrincipal());
    return ResponseEntity.noContent().build();
  }
}
