package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.exception.DriveShareLinkGoneException;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 채팅 앱 카드용 공유 링크 판정(WP-1474) 통합 테스트 — {@link DriveShareLinkService#appLinkCard}.
 *
 * <p>핵심: 같은 워크스페이스의 공간 구성원은 링크 상태(만료·폐기·비밀번호·사내)와 무관하게 Member. 비구성원은 링크로 열 수 있는지에 따라
 * Open·PasswordProtected 이거나 열 수 없으면 410({@link DriveShareLinkGoneException}), 다른 워크스페이스의 사내 링크는
 * 404. 비밀번호 시도 칸을 쓰지 않고, 요청자 컨텍스트가 되돌려진다. {@code @Transactional}: 끝나면 롤백된다.
 */
@Transactional
class DriveShareAppCardTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkService service;

  private long owner;
  private long member; // 공간 VIEWER
  private long outsider; // 같은 워크스페이스, 공간 구성원 아님
  private long spaceId;
  private long fileId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = seedUser("주인");
    member = seedUser("구성원");
    outsider = seedUser("남");
    spaceId = seedSpace(owner, "경영기획팀 공간");
    addMember(spaceId, member, "VIEWER");
    fileId = seedFile(spaceId, null, "2026 사업계획_최종.pdf");
  }

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  @Test
  void 구성원은_링크_상태와_무관하게_Member_와_공간_이름_이동_id_를_받는다() {
    String external = link(fileId, "EXTERNAL", null);
    String internal = link(fileId, "INTERNAL", null);
    String password = link(fileId, "EXTERNAL", "secret");
    String expired = link(fileId, "EXTERNAL", null);
    expire(expired);
    String revoked = revokedLink(fileId);

    var expected =
        new DriveShareAppCard.Member(
            "2026 사업계획_최종.pdf", "application/pdf", "경영기획팀 공간", spaceId, null, fileId);
    for (String t : new String[] {external, internal, password, expired, revoked}) {
      assertThat(service.appLinkCard(t, 1L, member)).isEqualTo(expected);
      assertThat(service.appLinkCard(t, 1L, owner)).isEqualTo(expected);
    }
    // 시도 칸을 쓰지 않는다
    assertThat(attempts(password)).isZero();
    // 요청자 컨텍스트가 되돌려진다
    assertThat(TenantContext.get()).isEqualTo(1L);
  }

  @Test
  void 구성원_카드는_파일이_든_폴더_id_를_싣는다() {
    long folderId =
        dsl.insertInto(DRIVE_FOLDER)
            .set(DRIVE_FOLDER.SPACE_ID, spaceId)
            .set(DRIVE_FOLDER.NAME, "보고서")
            .returning(DRIVE_FOLDER.ID)
            .fetchOne()
            .getId();
    long nested = seedFile(spaceId, folderId, "b.txt");
    String t = link(nested, "EXTERNAL", null);

    var card = (DriveShareAppCard.Member) service.appLinkCard(t, 1L, member);
    assertThat(card.folderId()).isEqualTo(folderId);
    assertThat(card.fileId()).isEqualTo(nested);
  }

  @Test
  void 같은_워크스페이스_비구성원은_열_수_있으면_Open_비밀번호면_PasswordProtected() {
    String external = link(fileId, "EXTERNAL", null);
    String internal = link(fileId, "INTERNAL", null);
    String password = link(fileId, "INTERNAL", "secret");
    OffsetDateTime until = OffsetDateTime.now().plusDays(7).truncatedTo(ChronoUnit.SECONDS);
    String expiring = linkUntil(fileId, until);

    assertThat(service.appLinkCard(external, 1L, outsider))
        .isEqualTo(
            new DriveShareAppCard.Open("2026 사업계획_최종.pdf", "application/pdf", 2411724L, null));
    assertThat(service.appLinkCard(internal, 1L, outsider))
        .isInstanceOf(DriveShareAppCard.Open.class);
    var open = (DriveShareAppCard.Open) service.appLinkCard(expiring, 1L, outsider);
    assertThat(open.expiresAt().toInstant()).isEqualTo(until.toInstant());
    assertThat(service.appLinkCard(password, 1L, outsider))
        .isEqualTo(new DriveShareAppCard.PasswordProtected(DriveShareTarget.FILE));
    assertThat(attempts(password)).isZero();
  }

  @Test
  void 비구성원에게_만료_폐기_없는_토큰_휴지통_비활성_워크스페이스는_410() {
    String expired = link(fileId, "EXTERNAL", "secret");
    expire(expired);
    String revoked = revokedLink(fileId);
    long trashedFile = seedFile(spaceId, null, "버린.txt");
    String trashed = link(trashedFile, "EXTERNAL", null);
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, OffsetDateTime.now())
        .where(DRIVE_FILE.ID.eq(trashedFile))
        .execute();

    assertGone(expired, 1L, outsider);
    assertGone(revoked, 1L, outsider);
    assertGone("sl_nope" + UUID.randomUUID().toString().replace("-", ""), 1L, outsider);
    assertGone(trashed, 1L, outsider);
    // 휴지통 파일은 구성원에게도 드라이브에서 열 파일이 없다 — 링크로도 열 수 없으니 410
    assertGone(trashed, 1L, member);
    // 다른 워크스페이스의 사내 링크라도 만료됐으면 없는 토큰과 같은 410(존재를 따로 드러내지 않는다)
    String internalExpired = link(fileId, "INTERNAL", null);
    expire(internalExpired);
    assertGone(internalExpired, 2L, outsider);
    // 410 이 나도 요청자 컨텍스트는 되돌려진다
    assertThat(TenantContext.get()).isEqualTo(1L);

    // 비활성 워크스페이스 — 구성원에게도 410
    String active = link(fileId, "EXTERNAL", null);
    dsl.update(TENANT).set(TENANT.STATUS, "DELETED").where(TENANT.ID.eq(1L)).execute();
    assertGone(active, 1L, member);
  }

  @Test
  void 다른_워크스페이스는_외부_링크만_보고_사내_링크는_404_구성원_판정도_하지_않는다() {
    String external = link(fileId, "EXTERNAL", null);
    String internal = link(fileId, "INTERNAL", null);
    String password = link(fileId, "EXTERNAL", "secret");
    String internalPassword = link(fileId, "INTERNAL", "secret");

    // 링크 워크스페이스의 구성원 id 여도 다른 워크스페이스 요청이면 Member 가 아니다(파일 위치를 주지 않는다)
    assertThat(service.appLinkCard(external, 2L, member))
        .isInstanceOf(DriveShareAppCard.Open.class);
    assertThat(service.appLinkCard(password, 2L, member))
        .isEqualTo(new DriveShareAppCard.PasswordProtected(DriveShareTarget.FILE));
    assertThatThrownBy(() -> service.appLinkCard(internal, 2L, member))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThatThrownBy(() -> service.appLinkCard(internalPassword, 2L, outsider))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    // 워크스페이스 없는 요청도 사내 링크는 404
    assertThatThrownBy(() -> service.appLinkCard(internal, null, member))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThat(attempts(password)).isZero();
    assertThat(TenantContext.get()).isEqualTo(1L);
  }

  @Test
  void 보관된_공간도_구성원은_열람할_수_있어_Member() {
    // 보관 공간은 쓰기만 막히고 VIEWER 열람은 된다(DrivePermissions.requireRole) — 「드라이브에서 열기」 판정(info)과 같은 규칙.
    // 보관 공간에서는 링크를 새로 만들 수 없으니(쓰기) 만든 뒤 보관한다.
    String t = link(fileId, "EXTERNAL", "secret");
    dsl.update(DRIVE_SPACE)
        .set(DRIVE_SPACE.ARCHIVED_AT, OffsetDateTime.now())
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .execute();

    assertThat(service.appLinkCard(t, 1L, member))
        .isEqualTo(
            new DriveShareAppCard.Member(
                "2026 사업계획_최종.pdf", "application/pdf", "경영기획팀 공간", spaceId, null, fileId));
    // 비구성원에게는 보관과 무관하게 링크 상태 그대로
    assertThat(service.appLinkCard(t, 1L, outsider))
        .isEqualTo(new DriveShareAppCard.PasswordProtected(DriveShareTarget.FILE));
  }

  @Test
  void 비밀번호_링크라도_파일이_휴지통이면_비구성원은_410_다른_워크스페이스도() {
    String password = link(fileId, "EXTERNAL", "secret");
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, OffsetDateTime.now())
        .where(DRIVE_FILE.ID.eq(fileId))
        .execute();

    assertGone(password, 1L, outsider);
    // 다른 워크스페이스 요청도 링크 워크스페이스 컨텍스트로 파일 행을 읽어 판정한다
    assertGone(password, 2L, outsider);
    // 시도 칸은 그대로, 요청자 컨텍스트는 되돌려진다
    assertThat(attempts(password)).isZero();
    assertThat(TenantContext.get()).isEqualTo(1L);
  }

  // --- 폴더 링크(WP-1538) ---

  /** 공간 S 에 {@code root/(sub/, f.txt)} — root 를 공유한다. */
  private long folderRoot() {
    long root = seedFolder("견적서");
    seedFolder("하위", root);
    seedFile(spaceId, root, "f.txt");
    return root;
  }

  private long seedFolder(String name) {
    return seedFolder(name, null);
  }

  private long seedFolder(String name, Long parent) {
    return dsl.insertInto(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.SPACE_ID, spaceId)
        .set(DRIVE_FOLDER.PARENT_ID, parent)
        .set(DRIVE_FOLDER.NAME, name)
        .returning(DRIVE_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  private String folderLink(long folderId, String audience, String password) {
    return service
        .create(
            owner,
            new DriveShareLinkService.Target.Folder(folderId),
            new CreateShareLinkRequest(audience, password, null))
        .token();
  }

  @Test
  void folder_member_returnsFolderMember() {
    long root = folderRoot();
    String t = folderLink(root, "INTERNAL", "secret");

    assertThat(service.appLinkCard(t, 1L, member))
        .isEqualTo(
            new DriveShareAppCard.FolderMember(
                "견적서", "경영기획팀 공간", spaceId, root, "INTERNAL", 1, 1, "주인"));
  }

  @Test
  void folder_open_nonMember() {
    long root = folderRoot();
    OffsetDateTime until = OffsetDateTime.now().plusDays(7).truncatedTo(ChronoUnit.SECONDS);
    String t =
        service
            .create(
                owner,
                new DriveShareLinkService.Target.Folder(root),
                new CreateShareLinkRequest("EXTERNAL", null, until.toInstant()))
            .token();

    var card = (DriveShareAppCard.FolderOpen) service.appLinkCard(t, 1L, outsider);
    assertThat(card.name()).isEqualTo("견적서");
    assertThat(card.audience()).isEqualTo("EXTERNAL");
    assertThat(card.folderCount()).isEqualTo(1);
    assertThat(card.fileCount()).isEqualTo(1);
    assertThat(card.sharedBy()).isEqualTo("주인");
    assertThat(card.expiresAt().toInstant()).isEqualTo(until.toInstant());
  }

  @Test
  void folder_password_nonMember() {
    String t = folderLink(folderRoot(), "EXTERNAL", "secret");
    assertThat(service.appLinkCard(t, 1L, outsider))
        .isEqualTo(new DriveShareAppCard.PasswordProtected(DriveShareTarget.FOLDER));
    assertThat(service.appLinkCard(t, 2L, outsider))
        .isEqualTo(new DriveShareAppCard.PasswordProtected(DriveShareTarget.FOLDER));
  }

  @Test
  void folder_otherWorkspace_internal_404() {
    String t = folderLink(folderRoot(), "INTERNAL", null);
    assertThatThrownBy(() -> service.appLinkCard(t, 2L, outsider))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
  }

  @Test
  void folder_closed_nonMember_410() {
    String t = folderLink(folderRoot(), "EXTERNAL", null);
    expire(t);
    assertGone(t, 1L, outsider);
    assertGone(t, 2L, outsider);
    // 구성원은 닫힌 링크여도 카드를 본다
    assertThat(service.appLinkCard(t, 1L, member))
        .isInstanceOf(DriveShareAppCard.FolderMember.class);
  }

  @Test
  void folder_trashed_410_evenForMember() {
    long root = folderRoot();
    String t = folderLink(root, "EXTERNAL", null);
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, OffsetDateTime.now())
        .where(DRIVE_FOLDER.ID.eq(root))
        .execute();
    assertGone(t, 1L, member);
    assertGone(t, 1L, outsider);
  }

  // --- 헬퍼 ---

  /** 보는 사람이 열 수 없는 링크 — 카드 대신 410(DriveShareLinkGoneException). */
  private void assertGone(String token, Long requesterTenantId, long requesterUserId) {
    assertThatThrownBy(() -> service.appLinkCard(token, requesterTenantId, requesterUserId))
        .isInstanceOf(DriveShareLinkGoneException.class);
  }

  private String link(long driveFileId, String audience, String password) {
    return service
        .create(owner, driveFileId, new CreateShareLinkRequest(audience, password, null))
        .token();
  }

  private String linkUntil(long driveFileId, OffsetDateTime until) {
    return service
        .create(owner, driveFileId, new CreateShareLinkRequest("EXTERNAL", null, until.toInstant()))
        .token();
  }

  private String revokedLink(long driveFileId) {
    var created =
        service.create(owner, driveFileId, new CreateShareLinkRequest("EXTERNAL", null, null));
    service.revoke(owner, created.id());
    return created.token();
  }

  /** 생성 검증(과거 만료일 금지)을 우회해 DB 로 만료시킨다. */
  private void expire(String token) {
    dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.EXPIRES_AT, OffsetDateTime.now().minusDays(1))
        .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(token)))
        .execute();
  }

  private int attempts(String token) {
    Integer n =
        dsl.select(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS)
            .from(DRIVE_SHARE_LINK_ATTEMPTS)
            .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(token)))
            .fetchOne(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS);
    return n == null ? 0 : n;
  }

  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ac_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, "ac_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedSpace(long ownerId, String name) {
    long id =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, name)
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    addMember(id, ownerId, "OWNER");
    return id;
  }

  private void addMember(long space, long userId, String role) {
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, userId)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .execute();
  }

  private long seedFile(long space, Long folderId, String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, name)
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/ac-" + s)
            .set(FILE.MIME_TYPE, "application/pdf")
            .set(FILE.SIZE_BYTES, 2411724L)
            .set(FILE.UPLOADED_BY, owner)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FOLDER_ID, folderId)
        .set(DRIVE_FILE.FILE_ID, coreFileId)
        .set(DRIVE_FILE.NAME, name)
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }
}
