package com.workplace.drive;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.exception.DriveQuotaExceededException;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 쿼터 경계 검사 — 한도 이내 통과, 초과 시 예외. */
@Transactional
class DriveQuotaServiceTest extends IntegrationTestBase {

  @Autowired DriveQuotaService quotaService;

  /** RLS(app.tenant_id) GUC 설정. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 한도_이내_통과() {
    // 기본 10GB, 사용 0 → 1바이트 통과
    quotaService.assertWithinQuota(1L);
  }

  @Test
  void 한도_초과시_예외() {
    long over = quotaService.view().quotaBytes() + 1;
    assertThatThrownBy(() -> quotaService.assertWithinQuota(over))
        .isInstanceOf(DriveQuotaExceededException.class);
  }

  @Test
  void view_returns_used_and_quota() {
    DriveQuotaService.QuotaView v = quotaService.view();
    assertThat(v.usedBytes()).isGreaterThanOrEqualTo(0L);
    assertThat(v.quotaBytes()).isEqualTo(10737418240L);
  }
}
