package com.workplace.drive;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveShareLinkService;
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

/**
 * 드라이브 활동이 중앙 audit_log 에 기록되는지 — FILE_UPLOAD / FILE_DELETE / FILE_SHARE.
 *
 * <p>클래스-레벨 {@code @Transactional}: 테스트 종료 후 자동 롤백으로 공유 test DB 오염을 방지한다. AuditLogService.log() 는
 * 독립적인 {@code @Transactional} 이 없으므로 같은 TX 에 합류하고, TX 내 {@code fetchCount} 로 즉시 조회된다.
 */
@Transactional
class DriveAuditLogTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveFileService driveFileService;
  @Autowired DriveShareLinkService shareLinkService;
  @Autowired DriveSpaceService spaceService;

  /** 테넌트 #1 RLS 컨텍스트 설정. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
    // 쿼터가 이미 초과 상태인 경우를 대비해 충분한 한도로 초기화한다.
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, 1073741824L).where(TENANT.ID.eq(1L)).execute();
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 테스트용 공간 생성. */
  private DriveSpaceResponse createSpace() {
    long u = seedUser();
    return spaceService.createTeamSpace(u, "팀_" + UUID.randomUUID().toString().substring(0, 4));
  }

  /** 파일 업로드 헬퍼. */
  private DriveFileResponse uploadFile(long spaceId, byte[] content) throws Exception {
    long u = ownerOfSpace(spaceId);
    MockMultipartFile f = new MockMultipartFile("file", "data.txt", "text/plain", content);
    return driveFileService.upload(u, spaceId, null, f);
  }

  /** 공간 소유자 사용자 ID 조회. */
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

  /** UUID 기반 고유 사용자 시드. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "al_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Al" + s)
        .set(USER.EMAIL, "al_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 업로드하면 FILE_UPLOAD 감사 로그가 기록된다. */
  @Test
  void 업로드는_FILE_UPLOAD_감사로그를_남긴다() throws Exception {
    DriveSpaceResponse space = createSpace();
    uploadFile(space.id(), "hello".getBytes());
    int count =
        dsl.fetchCount(
            AUDIT_LOG, AUDIT_LOG.RESOURCE.eq("drive").and(AUDIT_LOG.ACTION_TYPE.eq("FILE_UPLOAD")));
    assertThat(count).isGreaterThanOrEqualTo(1);
  }

  /** 파일 삭제(휴지통)하면 FILE_DELETE 감사 로그가 기록된다. */
  @Test
  void 삭제는_FILE_DELETE_감사로그를_남긴다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFileResponse uploaded = uploadFile(space.id(), "world".getBytes());
    long userId = ownerOfSpace(space.id());
    driveFileService.delete(userId, uploaded.id());
    int count =
        dsl.fetchCount(
            AUDIT_LOG, AUDIT_LOG.RESOURCE.eq("drive").and(AUDIT_LOG.ACTION_TYPE.eq("FILE_DELETE")));
    assertThat(count).isGreaterThanOrEqualTo(1);
  }

  /** 공유 링크 생성하면 FILE_SHARE 감사 로그가 기록된다. */
  @Test
  void 공유링크_생성은_FILE_SHARE_감사로그를_남긴다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFileResponse uploaded = uploadFile(space.id(), "share-me".getBytes());
    long userId = ownerOfSpace(space.id());
    shareLinkService.create(
        userId, uploaded.id(), new CreateShareLinkRequest("EXTERNAL", null, null));
    int count =
        dsl.fetchCount(
            AUDIT_LOG, AUDIT_LOG.RESOURCE.eq("drive").and(AUDIT_LOG.ACTION_TYPE.eq("FILE_SHARE")));
    assertThat(count).isGreaterThanOrEqualTo(1);
  }
}
