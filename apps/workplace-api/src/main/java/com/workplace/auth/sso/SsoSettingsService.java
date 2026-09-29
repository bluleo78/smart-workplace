package com.workplace.auth.sso;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.sso.dto.SsoSettingsResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.repository.TenantRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** WP-48 현재 워크스페이스의 SSO 설정 — 켜기/끄기와 관리자 동의 링크. */
@Service
@RequiredArgsConstructor
public class SsoSettingsService {

  private final SsoProperties props;
  private final M365OidcClient oidc;
  private final TenantRepository tenantRepository;
  private final UserRepository userRepository;
  private final AuditLogService auditLogService;

  /** 현재 테넌트의 SSO 설정 조회. available=false 면 동의 링크는 내려주지 않는다. */
  @Transactional(readOnly = true)
  public SsoSettingsResponse get() {
    Long tenantId = requireTenant();
    return new SsoSettingsResponse(
        props.isAvailable(),
        tenantRepository.isSsoEnabled(tenantId),
        props.isAvailable() ? oidc.adminConsentUrl() : null,
        userRepository.countPasswordlessHumanMembers(tenantId));
  }

  /** SSO 켜기/끄기 + 감사 로그. 운영자 앱 미설정 상태에서 켜기는 409. */
  @Transactional
  public void setEnabled(boolean enabled, Long callerId) {
    Long tenantId = requireTenant();
    if (enabled && !props.isAvailable()) {
      // 운영자 앱 미설정 — 켜도 아무도 로그인할 수 없다. IllegalStateException → 409.
      throw new IllegalStateException("SSO 를 사용하려면 운영자 설정이 필요합니다.");
    }
    tenantRepository.setSsoEnabled(tenantId, enabled);
    // audit_log.username 은 NOT NULL — 사용자를 못 찾으면 id 문자열로 대체한다.
    String callerName =
        userRepository.findById(callerId).map(u -> u.username()).orElse(String.valueOf(callerId));
    auditLogService.log(
        callerId, callerName, "SSO_SETTING_CHANGED", "tenant", String.valueOf(tenantId),
        enabled ? "SSO 로그인 사용" : "SSO 로그인 해제", null, null, "SUCCESS", null,
        Map.of("enabled", enabled));
  }

  private static Long requireTenant() {
    Long tenantId = TenantContext.get();
    if (tenantId == null) throw new IllegalStateException("SSO 설정에는 active 테넌트가 필요합니다.");
    return tenantId;
  }
}
