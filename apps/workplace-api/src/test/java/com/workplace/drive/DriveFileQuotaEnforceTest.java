package com.workplace.drive;

import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveQuotaExceededException;
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

/** 업로드 시 쿼터 강제 — 한도 초과면 거부. */
@Transactional
class DriveFileQuotaEnforceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveFileService driveFileService;
  @Autowired DriveSpaceService spaceService;

  /** 테넌트 #1 RLS 컨텍스트 설정. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 현재 테넌트(#1)의 quota_bytes 를 변경. */
  private void setTenantQuota(long quotaBytes) {
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, quotaBytes).where(TENANT.ID.eq(1L)).execute();
  }

  /** 테스트용 공간 생성. */
  private DriveSpaceResponse createSpace() {
    long u = seedUser();
    return spaceService.createTeamSpace(u, "팀_" + UUID.randomUUID().toString().substring(0, 4));
  }

  /** 파일 업로드 헬퍼 — text/plain(허용 타입)으로 업로드. */
  private DriveFileResponse uploadFile(long spaceId, byte[] content) throws Exception {
    long u = ownerOfSpace(spaceId);
    MockMultipartFile f = new MockMultipartFile("file", "data.txt", "text/plain", content);
    return driveFileService.upload(u, spaceId, null, f);
  }

  /** 공간 소유자 사용자 ID(seedUser 로 생성 후 공간에 연결). 동일 tx 이라 공간 소유자를 직접 얻기 위해 별도 생성. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "qe_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Qe" + s)
        .set(USER.EMAIL, "qe_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** space 소유자(OWNER)를 DB 에서 직접 조회. */
  private long ownerOfSpace(long spaceId) {
    return dsl.select(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.USER_ID)
        .from(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER)
        .where(
            com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER
                .SPACE_ID
                .eq(spaceId)
                .and(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.ROLE.eq("OWNER")))
        .limit(1)
        .fetchOne(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.USER_ID);
  }

  @Test
  void 한도_초과_업로드는_거부() throws Exception {
    // given: 한도 0으로 설정
    setTenantQuota(0L);
    DriveSpaceResponse space = createSpace();
    // when/then: 어떤 바이트든 업로드 거부
    assertThatThrownBy(() -> uploadFile(space.id(), "x".getBytes()))
        .isInstanceOf(DriveQuotaExceededException.class);
  }

  @Test
  void 한도_정확히_일치하면_허용() throws Exception {
    byte[] data = "hello".getBytes(); // 5바이트
    DriveSpaceResponse space = createSpace();
    setTenantQuota(5L);
    DriveFileResponse resp = uploadFile(space.id(), data); // 예외 없음
    assertThat(resp).isNotNull();
  }

  @Test
  void 누적_사용량이_한도를_막는다() throws Exception {
    // given: 한도 10바이트
    DriveSpaceResponse space = createSpace();
    setTenantQuota(10L);
    // 첫 번째 6바이트 — 통과
    uploadFile(space.id(), "aaaaaa".getBytes());
    // 두 번째 6바이트는 누적 12 > 10 → 거부되어야 한다
    assertThatThrownBy(() -> uploadFile(space.id(), "bbbbbb".getBytes()))
        .isInstanceOf(DriveQuotaExceededException.class);
  }

  @Test
  void 한도_초과_복사는_거부() throws Exception {
    // given: 먼저 파일을 업로드할 충분한 한도를 설정한다
    DriveSpaceResponse space = createSpace();
    setTenantQuota(5L);
    DriveFileResponse original = uploadFile(space.id(), "hello".getBytes()); // 5바이트 — 정확히 한도
    // when: 한도를 1바이트로 낮춰 복사 시 초과 발생 유도
    setTenantQuota(1L);
    long owner = ownerOfSpace(space.id());
    // then: 복사도 쿼터를 강제하므로 DriveQuotaExceededException 발생해야 한다
    assertThatThrownBy(() -> driveFileService.copy(owner, original.id(), null))
        .isInstanceOf(DriveQuotaExceededException.class);
  }
}
