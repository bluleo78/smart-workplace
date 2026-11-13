package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.ShareFolderListing;
import com.workplace.drive.dto.ShareInfoResponse;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveShareLinkGoneException;
import com.workplace.drive.exception.DriveShareLinkLockedException;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.drive.exception.DriveShareLinkUnauthorizedException;
import com.workplace.drive.repository.DriveSharedFolderRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 폴더 공유 링크 공개 열람(WP-1538) 통합 테스트 — 정보(FolderFull·Gate target)·하위 목록·자손 검사.
 *
 * <p>핵심: 공유 폴더 밖(형제·상위·다른 공간·다른 테넌트·휴지통·밖으로 옮긴 폴더) id 는 404. 자손 검사는 링크 가드와 비밀번호(열람 토큰) 판정 <b>뒤</b>에
 * 돌아서, 잠긴 사람은 401 만 받고 id 를 떠볼 수 없다.
 *
 * <p>픽스처: 공간 S 에 {@code P/ root/ (A/ A1/)}, {@code P/ sibling/ s.txt}, {@code root/f1.txt}, {@code
 * A/a.txt}, {@code A1/deep.pdf}, 공간 루트 파일 {@code top.txt}. 다른 공간 S2 에 {@code other/}. 공유 대상은 root.
 */
@Transactional
class DriveFolderShareViewTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkService service;
  @Autowired DriveSharedFolderRepository sharedFolders;
  @Autowired MockMvc mockMvc;

  // 시도 칸은 REQUIRES_NEW 로 독립 커밋되어 테스트 롤백에 지워지지 않는다 — 쓴 token_hash 를 모아 회수한다.
  private final List<String> tokenHashes = new ArrayList<>();

  private long owner;
  private long spaceId;
  private long p;
  private long root;
  private long a;
  private long a1;
  private long sibling;
  private long other;
  private long f1;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = seedUser("공유자");
    spaceId = seedSpace(owner);
    p = seedFolder(spaceId, null, "P");
    root = seedFolder(spaceId, p, "root");
    a = seedFolder(spaceId, root, "A");
    a1 = seedFolder(spaceId, a, "A1");
    sibling = seedFolder(spaceId, p, "sibling");
    f1 = seedFile(spaceId, root, "f1.txt", "text/plain");
    seedFile(spaceId, a, "a.txt", "text/plain");
    seedFile(spaceId, a1, "deep.pdf", "application/pdf");
    seedFile(spaceId, sibling, "s.txt", "text/plain");
    seedFile(spaceId, null, "top.txt", "text/plain");
    long s2 = seedSpace(owner);
    other = seedFolder(s2, null, "other");
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (!tokenHashes.isEmpty()) {
      dsl.deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
          .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.in(tokenHashes))
          .execute();
      tokenHashes.clear();
    }
  }

  // --- 열기 — 외부·사내·비밀번호 ---

  @Test
  void info_external_folderFull() {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();

    var info = (ShareInfoResponse.FolderFull) service.info(token, null, null, null);
    assertThat(info.passwordRequired()).isFalse();
    assertThat(info.loginRequired()).isFalse();
    assertThat(info.kind()).isEqualTo(DriveShareTarget.FOLDER);
    assertThat(info.name()).isEqualTo("root");
    // 바로 아래 살아 있는 항목만(P5) — A 하나, f1.txt 하나(sibling·A1·a.txt 는 세지 않는다)
    assertThat(info.folderCount()).isEqualTo(1);
    assertThat(info.fileCount()).isEqualTo(1);
    assertThat(info.sharedBy()).isEqualTo("공유자");
    assertThat(info.loginAvailable()).isTrue();
    assertThat(info.driveOpen()).isNull();
  }

  @Test
  void info_internal_anonymous_gateWithTargetFolder() {
    String token = folderLink("INTERNAL", null);
    TenantContext.clear();
    assertThat(service.info(token, null, null, null))
        .isEqualTo(new ShareInfoResponse.Gate(false, true, DriveShareTarget.FOLDER));
  }

  @Test
  void info_internal_sameTenantMember_driveOpenHasFolder() {
    String token = folderLink("INTERNAL", null);
    long outsider = seedUser("x");

    var info = (ShareInfoResponse.FolderFull) service.info(token, null, 1L, owner);
    assertThat(info.driveOpen()).isEqualTo(new ShareInfoResponse.FolderDriveOpen(spaceId, root));
    assertThat(info.loginAvailable()).isFalse();
    // 같은 워크스페이스지만 공간 구성원이 아니면 위치를 주지 않는다
    assertThat(((ShareInfoResponse.FolderFull) service.info(token, null, 1L, outsider)).driveOpen())
        .isNull();
    assertThat(TenantContext.get()).isEqualTo(1L);
  }

  @Test
  void info_password_gate_thenUnlock_thenInfoAndChildren200() {
    String token = folderLink("EXTERNAL", "secret");
    TenantContext.clear();

    assertThat(service.info(token, null, null, null))
        .isEqualTo(new ShareInfoResponse.Gate(true, false, DriveShareTarget.FOLDER));
    assertThatThrownBy(() -> service.children(token, null, null, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);

    String vt = service.unlock(token, "secret", null, false).viewToken();
    var info = (ShareInfoResponse.FolderFull) service.info(token, vt, null, null);
    assertThat(info.name()).isEqualTo("root");
    ShareFolderListing listing = service.children(token, vt, null, null, false);
    assertThat(listing.folderId()).isEqualTo(root);
    assertThat(listing.folders())
        .extracting(ShareFolderListing.FolderItem::name)
        .containsExactly("A");
  }

  @Test
  void info_fileLink_kindFile_andGateTargetFile() {
    String open = fileLink(f1, "EXTERNAL", null);
    String locked = fileLink(f1, "EXTERNAL", "secret");
    TenantContext.clear();

    var full = (ShareInfoResponse.Full) service.info(open, null, null, null);
    assertThat(full.kind()).isEqualTo(DriveShareTarget.FILE);
    assertThat(full.name()).isEqualTo("f1.txt");
    assertThat(service.info(locked, null, null, null))
        .isEqualTo(new ShareInfoResponse.Gate(true, false, DriveShareTarget.FILE));
  }

  // --- 자손 목록 ---

  @Test
  void children_root_foldersFirstThenFiles_byName() {
    seedFolder(spaceId, root, "B");
    seedFile(spaceId, root, "e0.txt", "text/plain");
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();

    ShareFolderListing listing = service.children(token, null, null, null, false);
    assertThat(listing.folderId()).isEqualTo(root);
    assertThat(listing.path()).containsExactly(new ShareFolderListing.PathItem(root, "root"));
    assertThat(listing.folders())
        .extracting(ShareFolderListing.FolderItem::name)
        .containsExactly("A", "B");
    assertThat(listing.files())
        .extracting(ShareFolderListing.FileItem::name)
        .containsExactly("e0.txt", "f1.txt");
    var f = listing.files().get(1);
    assertThat(f.id()).isEqualTo(f1);
    assertThat(f.mimeType()).isEqualTo("text/plain");
    assertThat(f.sizeBytes()).isEqualTo(3L);
    assertThat(f.updatedAt()).isNotNull();
    assertThat(listing.truncated()).isFalse();
  }

  @Test
  void children_twoLevels_pathOrderedRootToCurrent() {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();

    ShareFolderListing listing = service.children(token, null, a1, null, false);
    assertThat(listing.folderId()).isEqualTo(a1);
    assertThat(listing.path())
        .containsExactly(
            new ShareFolderListing.PathItem(root, "root"),
            new ShareFolderListing.PathItem(a, "A"),
            new ShareFolderListing.PathItem(a1, "A1"));
    assertThat(listing.folders()).isEmpty();
    assertThat(listing.files())
        .extracting(ShareFolderListing.FileItem::name)
        .containsExactly("deep.pdf");
    assertThat(listing.files().get(0).mimeType()).isEqualTo("application/pdf");
  }

  @Test
  void children_folderEqualsRoot_sameAsRoot() {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    assertThat(service.children(token, null, root, null, false))
        .isEqualTo(service.children(token, null, null, null, false));
  }

  // --- 밖 id 404 ---

  @Test
  void children_siblingFolder_404() {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    assertNotFound(token, sibling);
  }

  @Test
  void children_parentOfRoot_404() {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    assertNotFound(token, p);
  }

  @Test
  void children_otherSpaceFolder_404() {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    assertNotFound(token, other);
    // 없는 id 도 같은 404
    assertNotFound(token, Long.MAX_VALUE);
  }

  @Test
  void children_otherTenantFolderId_404() {
    long t2 = ensureFixtureTenant("wp1538-folder-share-other");
    String token = folderLink("EXTERNAL", null);
    useTenant(t2);
    long t2Space = seedSpace(owner);
    long t2Folder = seedFolder(t2Space, null, "t2");
    useTenant(1L);
    TenantContext.clear();
    // 링크 테넌트(1)의 RLS 아래에서는 tenant 2 폴더가 보이지 않는다
    assertNotFound(token, t2Folder);
  }

  @Test
  void children_passwordLocked_outsideId_401_beforeDescendantCheck() {
    String token = folderLink("EXTERNAL", "secret");
    TenantContext.clear();
    for (long id : new long[] {sibling, p, other, Long.MAX_VALUE, a1}) {
      assertThatThrownBy(() -> service.children(token, null, id, null, false))
          .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    }
  }

  // --- 휴지통·이동 ---

  @Test
  void children_trashedSubfolder_404_andHiddenFromParentList() {
    String token = folderLink("EXTERNAL", null);
    // A 만 휴지통 표시 — A1 은 살아 있어도 사슬에 휴지통 조상이 있어 404 여야 한다(사슬 전체 검사)
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, dbNow())
        .where(DRIVE_FOLDER.ID.eq(a))
        .execute();
    TenantContext.clear();

    assertNotFound(token, a);
    assertNotFound(token, a1);
    ShareFolderListing listing = service.children(token, null, null, null, false);
    assertThat(listing.folders()).isEmpty();
    var info = (ShareInfoResponse.FolderFull) service.info(token, null, null, null);
    assertThat(info.folderCount()).isZero();
  }

  @Test
  void children_trashedFile_hiddenFromList() {
    String token = folderLink("EXTERNAL", null);
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, dbNow())
        .where(DRIVE_FILE.ID.eq(f1))
        .execute();
    TenantContext.clear();
    assertThat(service.children(token, null, null, null, false).files()).isEmpty();
    assertThat(((ShareInfoResponse.FolderFull) service.info(token, null, null, null)).fileCount())
        .isZero();
  }

  @Test
  void children_movedOutside_404() {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    assertThat(service.children(token, null, a1, null, false).folderId()).isEqualTo(a1);

    TenantContext.set(1L);
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.PARENT_ID, sibling)
        .where(DRIVE_FOLDER.ID.eq(a1))
        .execute();
    TenantContext.clear();
    assertNotFound(token, a1);
  }

  @Test
  void sharedFolderTrashed_info404_thenRestored_200() {
    String token = folderLink("EXTERNAL", null);
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, dbNow())
        .where(DRIVE_FOLDER.ID.eq(root))
        .execute();
    TenantContext.clear();
    assertThatThrownBy(() -> service.info(token, null, null, null))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    assertNotFound(token, root);

    TenantContext.set(1L);
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, (java.time.OffsetDateTime) null)
        .where(DRIVE_FOLDER.ID.eq(root))
        .execute();
    TenantContext.clear();
    assertThat(service.info(token, null, null, null))
        .isInstanceOf(ShareInfoResponse.FolderFull.class);
  }

  // --- 사내 다른 테넌트 ---

  @Test
  void internal_otherTenant_info403_children403() {
    String token = folderLink("INTERNAL", null);
    TenantContext.clear();
    assertThatThrownBy(() -> service.info(token, null, 2L, owner))
        .isInstanceOf(DriveForbiddenException.class);
    assertThatThrownBy(() -> service.children(token, null, null, 2L, true))
        .isInstanceOf(DriveForbiddenException.class);
  }

  @Test
  void internal_anonymous_children401() {
    String token = folderLink("INTERNAL", null);
    TenantContext.clear();
    assertThatThrownBy(() -> service.children(token, null, null, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    // 같은 워크스페이스 로그인은 연다
    assertThat(service.children(token, null, null, 1L, true).folderId()).isEqualTo(root);
  }

  // --- 폐기·만료 ---

  @Test
  void revoked_info410_children410() {
    var created =
        service.create(
            owner,
            new DriveShareLinkService.Target.Folder(root),
            new CreateShareLinkRequest("EXTERNAL", null, null));
    tokenHashes.add(CapabilityTokens.sha256Hex(created.token()));
    service.revoke(owner, created.id());
    TenantContext.clear();
    assertThatThrownBy(() -> service.info(created.token(), null, null, null))
        .isInstanceOf(DriveShareLinkGoneException.class);
    assertThatThrownBy(() -> service.children(created.token(), null, null, null, false))
        .isInstanceOf(DriveShareLinkGoneException.class);
  }

  @Test
  void expired_info410_children410() {
    String token = folderLink("EXTERNAL", null);
    dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.EXPIRES_AT, dbNow().minusDays(1))
        .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(token)))
        .execute();
    TenantContext.clear();
    assertThatThrownBy(() -> service.info(token, null, null, null))
        .isInstanceOf(DriveShareLinkGoneException.class);
    assertThatThrownBy(() -> service.children(token, null, a, null, false))
        .isInstanceOf(DriveShareLinkGoneException.class);
  }

  // --- 시도 제한 ---

  @Test
  void password_fiveFailures_locked429_existingViewTokenChildren401_andAuditTargetsFolder() {
    String token = folderLink("EXTERNAL", "secret");
    TenantContext.clear();
    String vt = service.unlock(token, "secret", null, false).viewToken();
    assertThat(service.children(token, vt, null, null, false).folderId()).isEqualTo(root);

    for (int i = 0; i < 5; i++) {
      assertThatThrownBy(() -> service.unlock(token, "wrong", null, false))
          .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    }
    assertThatThrownBy(() -> service.unlock(token, "secret", null, false))
        .isInstanceOf(DriveShareLinkLockedException.class);
    assertThatThrownBy(() -> service.children(token, vt, null, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);

    TenantContext.set(1L);
    var audit =
        dsl.select(AUDIT_LOG.RESOURCE_ID, AUDIT_LOG.METADATA)
            .from(AUDIT_LOG)
            .where(AUDIT_LOG.ACTION_TYPE.eq("SHARE_LINK_LOCKED"))
            .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(root)))
            .fetch();
    assertThat(audit).hasSize(1);
    JSONB meta = audit.get(0).get(AUDIT_LOG.METADATA);
    assertThat(
            dsl.select(DSL.field("({0}::jsonb)->>'target'", String.class, DSL.val(meta.data())))
                .fetchOne(0, String.class))
        .isEqualTo("FOLDER");
  }

  // --- 경계 ---

  @Test
  void children_truncatedOver1000() {
    dsl.execute(
        "INSERT INTO drive_folder(space_id, parent_id, name) "
            + "SELECT ?, ?, 'bulk-' || lpad(g::text, 4, '0') FROM generate_series(1, 1001) g",
        spaceId,
        root);
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();

    ShareFolderListing listing = service.children(token, null, null, null, false);
    assertThat(listing.folders()).hasSize(1000);
    assertThat(listing.files()).isEmpty();
    assertThat(listing.truncated()).isTrue();
  }

  @Test
  void chain_isOrderedRootToCurrent_andTerminatesOnCycle() {
    assertThat(sharedFolders.chainToRoot(a1, root))
        .extracting(DriveSharedFolderRepository.ChainRow::id)
        .containsExactly(root, a, a1);
    assertThat(sharedFolders.chainToRoot(root, root))
        .extracting(DriveSharedFolderRepository.ChainRow::id)
        .containsExactly(root);

    String token = folderLink("EXTERNAL", null);
    // A ↔ A1 순환(WP-762 류 손상 데이터) — 재귀가 끝나야 하고, root 가 사슬에 없으니 404
    dsl.update(DRIVE_FOLDER).set(DRIVE_FOLDER.PARENT_ID, a1).where(DRIVE_FOLDER.ID.eq(a)).execute();
    var chain = sharedFolders.chainToRoot(a1, root);
    assertThat(chain)
        .extracting(DriveSharedFolderRepository.ChainRow::id)
        .containsExactlyInAnyOrder(a, a1);
    TenantContext.clear();
    assertNotFound(token, a1);
  }

  @Test
  void fileLink_children_404() {
    String token = fileLink(f1, "EXTERNAL", null);
    TenantContext.clear();
    assertThatThrownBy(() -> service.children(token, null, null, null, false))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThatThrownBy(() -> service.children(token, null, root, null, false))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
  }

  @Test
  void children_http_noStoreHeader() throws Exception {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    mockMvc
        .perform(get("/api/v1/public/drive/share/" + token + "/children"))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.folderId").value(root))
        .andExpect(jsonPath("$.path[0].name").value("root"))
        .andExpect(jsonPath("$.folders[0].name").value("A"))
        .andExpect(jsonPath("$.files[0].name").value("f1.txt"))
        .andExpect(jsonPath("$.files[0].storagePath").doesNotExist())
        .andExpect(jsonPath("$.files[0].spaceId").doesNotExist())
        .andExpect(jsonPath("$.spaceId").doesNotExist())
        .andExpect(jsonPath("$.truncated").value(false));
    mockMvc
        .perform(
            get("/api/v1/public/drive/share/" + token + "/children")
                .param("folder", String.valueOf(sibling)))
        .andExpect(status().isNotFound());
  }

  // --- 헬퍼 ---

  private void assertNotFound(String token, long folderId) {
    assertThatThrownBy(() -> service.children(token, null, folderId, null, false))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
  }

  private String folderLink(String audience, String password) {
    var created =
        service.create(
            owner,
            new DriveShareLinkService.Target.Folder(root),
            new CreateShareLinkRequest(audience, password, null));
    tokenHashes.add(CapabilityTokens.sha256Hex(created.token()));
    return created.token();
  }

  private String fileLink(long driveFileId, String audience, String password) {
    var created =
        service.create(owner, driveFileId, new CreateShareLinkRequest(audience, password, null));
    tokenHashes.add(CapabilityTokens.sha256Hex(created.token()));
    return created.token();
  }

  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "fs_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, "fs_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedSpace(long ownerId) {
    long id =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "sp-" + UUID.randomUUID().toString().substring(0, 6))
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, id)
        .set(DRIVE_SPACE_MEMBER.USER_ID, ownerId)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    return id;
  }

  private long seedFolder(long space, Long parent, String name) {
    return dsl.insertInto(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.SPACE_ID, space)
        .set(DRIVE_FOLDER.PARENT_ID, parent)
        .set(DRIVE_FOLDER.NAME, name)
        .returning(DRIVE_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  private long seedFile(long space, Long folder, String name, String mime) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, name)
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/fs-" + s)
            .set(FILE.MIME_TYPE, mime)
            .set(FILE.SIZE_BYTES, 3L)
            .set(FILE.UPLOADED_BY, owner)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FOLDER_ID, folder)
        .set(DRIVE_FILE.FILE_ID, coreFileId)
        .set(DRIVE_FILE.NAME, name)
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }
}
