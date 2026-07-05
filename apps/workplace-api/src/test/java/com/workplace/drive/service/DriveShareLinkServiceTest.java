package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveShareLinkServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkService service;

  @BeforeEach
  void setCtx() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearCtx() {
    TenantContext.clear();
  }

  @Test
  void create_returnsPlaintextToken_andStoresHash() {
    long owner = seedUser();
    long spaceId = seedSpace(owner);
    long fileId = seedFile(owner, spaceId);

    var created = service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, null));
    assertThat(created.token()).startsWith("sl_");
    assertThat(created.hasPassword()).isFalse();
    // 목록엔 토큰 없음, 1건
    var list = service.list(owner, fileId);
    assertThat(list).hasSize(1);
  }

  @Test
  void create_withPassword_hashesBcrypt() {
    long owner = seedUser();
    long fileId = seedFile(owner, seedSpace(owner));
    var created =
        service.create(owner, fileId, new CreateShareLinkRequest("INTERNAL", "secret", null));
    assertThat(created.hasPassword()).isTrue();
  }

  @Test
  void create_byViewer_isForbidden() {
    long owner = seedUser();
    long viewer = seedUser();
    long spaceId = seedSpace(owner);
    addMember(spaceId, viewer, "VIEWER");
    long fileId = seedFile(owner, spaceId);
    assertThatThrownBy(
            () ->
                service.create(viewer, fileId, new CreateShareLinkRequest("EXTERNAL", null, null)))
        .isInstanceOf(DriveForbiddenException.class);
  }

  // 과거 만료일 차단(#673) — 프런트 가드 우회(직접 API 호출) 시나리오까지 서버가 방어해야 한다.
  @Test
  void create_withPastExpiresAt_throwsInvalidTarget() {
    long owner = seedUser();
    long fileId = seedFile(owner, seedSpace(owner));
    Instant past = Instant.now().minus(1, ChronoUnit.DAYS);

    assertThatThrownBy(
            () -> service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, past)))
        .isInstanceOf(DriveInvalidTargetException.class);

    // 생성 자체가 거부돼 목록에 남지 않아야 한다
    assertThat(service.list(owner, fileId)).isEmpty();
  }

  @Test
  void revoke_thenList_showsRevoked() {
    long owner = seedUser();
    long fileId = seedFile(owner, seedSpace(owner));
    var created = service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, null));
    service.revoke(owner, created.id());
    assertThat(service.list(owner, fileId).get(0).revoked()).isTrue();
  }

  // --- 시드 헬퍼 (DriveShareLinkRepositoryTest UUID-suffix 패턴) ---

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "sl_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Sl" + s)
        .set(USER.EMAIL, "sl_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedSpace(long ownerId) {
    long spaceId =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "sp")
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, ownerId)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    return spaceId;
  }

  /** file core + drive_file 행 삽입. FILE 테이블의 NOT NULL 컬럼 전부 포함. */
  private long seedFile(long uploadedBy, long spaceId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "a.txt")
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/a-" + s + ".txt")
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 3L)
            .set(FILE.UPLOADED_BY, uploadedBy)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, coreFileId)
        .set(DRIVE_FILE.NAME, "a.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  /** DRIVE_SPACE_MEMBER 에 멤버 추가. */
  private void addMember(long spaceId, long userId, String role) {
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, userId)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .execute();
  }
}
