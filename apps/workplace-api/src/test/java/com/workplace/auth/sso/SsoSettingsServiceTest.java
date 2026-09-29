package com.workplace.auth.sso;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.workplace.audit.service.AuditLogService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.repository.TenantRepository;
import com.workplace.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** WP-48 SsoSettingsService 단위 테스트 — 운영자 앱 미설정(available=false) 시 켜기는 거부(409 매핑). */
class SsoSettingsServiceTest {

  private final TenantRepository tenantRepository = mock(TenantRepository.class);

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  @Test
  void enable_whenUnavailable_throwsIllegalState() {
    TenantContext.set(1L);
    var props = new SsoProperties(null, null, null, null);
    var service =
        new SsoSettingsService(
            props,
            mock(M365OidcClient.class),
            tenantRepository,
            mock(UserRepository.class),
            mock(AuditLogService.class));

    assertThatThrownBy(() -> service.setEnabled(true, 1L))
        .isInstanceOf(IllegalStateException.class);
    verifyNoInteractions(tenantRepository);
  }
}
