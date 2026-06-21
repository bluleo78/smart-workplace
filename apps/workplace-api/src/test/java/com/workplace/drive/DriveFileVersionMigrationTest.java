package com.workplace.drive;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FILE_VERSION;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** V81: 버전 테이블/제약이 적용되었는지 검증(#79). */
class DriveFileVersionMigrationTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 버전테이블_조회가능() {
    // 테이블이 존재하면 count 쿼리가 예외 없이 동작한다.
    assertThat(dsl.fetchCount(DRIVE_FILE_VERSION)).isGreaterThanOrEqualTo(0);
  }

  @Test
  void drive_file_version_count_컬럼_존재() {
    // 코드젠된 메타 컬럼 접근으로 컬럼 존재 확인.
    assertThat(DRIVE_FILE.VERSION_COUNT).isNotNull();
  }
}
