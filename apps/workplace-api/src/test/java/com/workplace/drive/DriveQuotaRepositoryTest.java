package com.workplace.drive;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.repository.DriveQuotaRepository;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** 드라이브 사용량 합산 — live 파일만, 휴지통 제외, chat 첨부 제외. */
@Transactional
class DriveQuotaRepositoryTest extends IntegrationTestBase {

  @Autowired DriveQuotaRepository quota;
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService driveFileService;

  /** RLS(app.tenant_id) GUC 설정 — INSERT/SELECT 모두 테넌트#1 스코프. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 테스트용 사용자 생성. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "qr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Qr" + s)
        .set(USER.EMAIL, "qr_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void 빈_공간은_사용량_0() {
    assertThat(quota.sumDriveUsageBytes()).isEqualTo(0L);
  }

  @Test
  void 업로드하면_사용량_증가_삭제하면_감소() throws Exception {
    // given: 공간 + 파일 업로드
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    byte[] content = "hello world".getBytes(); // 11바이트
    MockMultipartFile f = new MockMultipartFile("file", "test.txt", "text/plain", content);
    var uploaded = driveFileService.upload(u, sp.id(), null, f);

    // then: live 사용량 = 파일 크기
    assertThat(quota.sumDriveUsageBytes()).isEqualTo(11L);

    // when: 휴지통 이동
    driveFileService.delete(u, uploaded.id());

    // then: live 집계에서 제외
    assertThat(quota.sumDriveUsageBytes()).isEqualTo(0L);
  }
}
