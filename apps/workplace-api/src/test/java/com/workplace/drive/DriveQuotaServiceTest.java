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

  /** 초과 메시지는 원시 바이트 정수가 아닌 사람이 읽기 쉬운 단위(GB 등)를 담아야 한다(#821). */
  @Test
  void 한도_초과시_메시지는_바이트_대신_사람이_읽기_쉬운_단위() {
    long over = quotaService.view().quotaBytes() + 1;
    assertThatThrownBy(() -> quotaService.assertWithinQuota(over))
        .isInstanceOf(DriveQuotaExceededException.class)
        .hasMessageContaining("GB")
        .hasMessageNotContaining("바이트")
        .hasMessageNotContaining("10737418240");
  }

  @Test
  void view_returns_used_and_quota() {
    DriveQuotaService.QuotaView v = quotaService.view();
    assertThat(v.usedBytes()).isGreaterThanOrEqualTo(0L);
    assertThat(v.quotaBytes()).isEqualTo(10737418240L);
  }
}
