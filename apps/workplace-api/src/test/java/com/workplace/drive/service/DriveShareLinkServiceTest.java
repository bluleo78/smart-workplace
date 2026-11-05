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
import com.workplace.drive.repository.DriveSpaceRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveShareLinkServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkService service;
  @Autowired DriveSpaceRepository spaces;

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

  // WP-1385: 공백·NBSP·폭 없는 공백·한글 채움·점자 빈칸처럼 보이는 글자가 없는 비밀번호는 조용히 「비밀번호 없는 공개 링크」로
  // 바뀌지 않도록 400 으로 거절하고, 링크도 남기지 않는다.
  @ParameterizedTest
  @ValueSource(
      strings = {
        "   ",
        " \t\n",
        "\u00A0\u00A0",
        "\u200B",
        "\u3164",
        "\uFEFF\u2060",
        "\u115F\u1160\uFFA0",
        "\u2800"
      })
  void create_withInvisibleOnlyPassword_isRejected(String password) {
    long owner = seedUser();
    long fileId = seedFile(owner, seedSpace(owner));

    assertThatThrownBy(
            () ->
                service.create(
                    owner, fileId, new CreateShareLinkRequest("EXTERNAL", password, null)))
        .isInstanceOf(DriveInvalidTargetException.class)
        .hasMessage("비밀번호에 공백만 넣을 수 없어요. 비밀번호를 입력하거나 칸을 비워 주세요.");
    assertThat(service.list(owner, fileId)).isEmpty();
  }

  // WP-1385 회귀: 사이·앞뒤에 공백이 있어도 보이는 글자가 있으면 비밀번호 링크다.
  @ParameterizedTest
  @ValueSource(strings = {"a b", " pw 1 "})
  void create_withPasswordContainingSpaces_hasPassword(String password) {
    long owner = seedUser();
    long fileId = seedFile(owner, seedSpace(owner));
    var created =
        service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", password, null));
    assertThat(created.hasPassword()).isTrue();
  }

  // WP-1385 회귀: 칸을 비운 경우(빈 문자열)는 지금처럼 비밀번호 없는 링크다.
  @Test
  void create_withEmptyPassword_createsLinkWithoutPassword() {
    long owner = seedUser();
    long fileId = seedFile(owner, seedSpace(owner));
    var created = service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", "", null));
    assertThat(created.hasPassword()).isFalse();
    assertThat(service.list(owner, fileId)).hasSize(1);
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

  // 보관 공간(WP-526) — 읽기전용이어도 이미 나간 링크를 보고 끊을 수는 있어야 한다. 새 링크 발급은 여전히 막는다.
  @Test
  void archivedSpace_allowsListAndRevoke_butBlocksCreate() {
    long owner = seedUser();
    long spaceId = seedSpace(owner);
    long fileId = seedFile(owner, spaceId);
    var created = service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, null));
    spaces.setArchived(spaceId, true);

    assertThat(service.list(owner, fileId)).hasSize(1);
    service.revoke(owner, created.id());
    assertThat(service.list(owner, fileId).get(0).revoked()).isTrue();
    assertThatThrownBy(
            () -> service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, null)))
        .isInstanceOf(DriveForbiddenException.class);
  }

  // 보관 공간이어도 역할 검증은 그대로 — VIEWER 는 목록·폐기 불가.
  @Test
  void archivedSpace_viewerStillForbidden() {
    long owner = seedUser();
    long viewer = seedUser();
    long spaceId = seedSpace(owner);
    addMember(spaceId, viewer, "VIEWER");
    long fileId = seedFile(owner, spaceId);
    var created = service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, null));
    spaces.setArchived(spaceId, true);

    assertThatThrownBy(() -> service.list(viewer, fileId))
        .isInstanceOf(DriveForbiddenException.class);
    assertThatThrownBy(() -> service.revoke(viewer, created.id()))
        .isInstanceOf(DriveForbiddenException.class);
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
