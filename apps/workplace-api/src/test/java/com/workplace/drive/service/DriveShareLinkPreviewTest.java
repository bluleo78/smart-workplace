package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.exception.DriveShareLinkGoneException;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공유 링크 미리보기 카드(WP-1473) 통합 테스트 — 실제 DB 의 링크로 {@code previewCard} 와 익명 HTTP {@code preview-meta} 를
 * 본다.
 *
 * <p>핵심: 비밀번호·사내 링크는 응답에 파일 이름·크기·종류가 없고, 열 수 없는 링크(없음·만료·폐기·휴지통)는 204 빈 본문이다.
 */
@Transactional
class DriveShareLinkPreviewTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkService service;
  @Autowired MockMvc mvc;

  private static final String BASE = "/api/v1/public/drive/share/";

  @BeforeEach
  void setCtx() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearCtx() {
    TenantContext.clear();
  }

  @Test
  void external_withExpiry_showsNameTypeSizeAndImage() throws Exception {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner), "사업계획.pdf");
    String token = link(owner, fileId, "EXTERNAL", null, Instant.now().plus(3, ChronoUnit.DAYS));
    TenantContext.clear();

    assertThat(service.previewCard(token)).isInstanceOf(DriveSharePreview.Open.class);

    String meta =
        body(
            mvc.perform(get(BASE + token + "/preview-meta"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "text/html;charset=UTF-8"))
                .andExpect(header().string("X-Robots-Tag", "noindex, nofollow"))
                .andExpect(header().string("Cache-Control", "no-store")));
    assertThat(meta)
        .contains("og:title\" content=\"사업계획.pdf\"")
        .contains("공유된 파일 · PDF · 3 B · ")
        .contains("일까지");

    String image =
        body(
            mvc.perform(get(BASE + token + "/preview-meta?part=image")).andExpect(status().isOk()));
    assertThat(image).contains("/og/drive-pdf.png").doesNotContain("사업계획");
    // 알 수 없는 part 는 meta 로 본다.
    assertThat(body(mvc.perform(get(BASE + token + "/preview-meta?part=zzz")))).isEqualTo(meta);
  }

  @Test
  void passwordLink_hidesFileInfo() throws Exception {
    long owner = seedUser("o");
    String token = link(owner, seedFile(seedSpace(owner), "비밀계획.pdf"), "EXTERNAL", "secret", null);
    TenantContext.clear();

    assertThat(service.previewCard(token)).isInstanceOf(DriveSharePreview.PasswordProtected.class);
    String meta = body(mvc.perform(get(BASE + token + "/preview-meta")).andExpect(status().isOk()));
    assertThat(meta)
        .contains("og:title\" content=\"비밀번호로 보호된 공유 파일\"")
        .contains("링크를 열고 비밀번호를 입력하면 볼 수 있습니다.")
        .doesNotContain("비밀계획")
        .doesNotContain("PDF")
        .doesNotContain(" B");
    assertThat(body(mvc.perform(get(BASE + token + "/preview-meta?part=image"))))
        .contains("drive-password.png");
  }

  @Test
  void internalLink_hidesFileInfo_evenWithPassword() throws Exception {
    long owner = seedUser("o");
    long spaceId = seedSpace(owner);
    String plain = link(owner, seedFile(spaceId, "내부.pdf"), "INTERNAL", null, null);
    String withPw = link(owner, seedFile(spaceId, "내부2.pdf"), "INTERNAL", "secret", null);
    TenantContext.clear();

    for (String token : new String[] {plain, withPw}) {
      assertThat(service.previewCard(token)).isInstanceOf(DriveSharePreview.InternalOnly.class);
      assertThat(body(mvc.perform(get(BASE + token + "/preview-meta")).andExpect(status().isOk())))
          .contains("og:title\" content=\"사내 공유 파일\"")
          .contains("Gen:iA Works 에 로그인하면 볼 수 있습니다.")
          .doesNotContain("내부");
      assertThat(body(mvc.perform(get(BASE + token + "/preview-meta?part=image"))))
          .contains("drive-internal.png");
    }
  }

  @Test
  void unavailableLinks_are204WithEmptyBody() throws Exception {
    long owner = seedUser("o");
    long spaceId = seedSpace(owner);
    String expired = link(owner, seedFile(spaceId, "a.pdf"), "EXTERNAL", null, null);
    dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.EXPIRES_AT, dbNow().minusDays(1))
        .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(expired)))
        .execute();
    var created =
        service.create(
            owner, seedFile(spaceId, "b.pdf"), new CreateShareLinkRequest("EXTERNAL", null, null));
    service.revoke(owner, created.id());
    long trashedId = seedFile(spaceId, "c.pdf");
    String trashed = link(owner, trashedId, "EXTERNAL", null, null);
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, dbNow())
        .where(DRIVE_FILE.ID.eq(trashedId))
        .execute();
    TenantContext.clear();

    assertThatThrownBy(() -> service.previewCard("sl_nope"))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThatThrownBy(() -> service.previewCard(expired))
        .isInstanceOf(DriveShareLinkGoneException.class);
    assertThatThrownBy(() -> service.previewCard(created.token()))
        .isInstanceOf(DriveShareLinkGoneException.class);
    assertThatThrownBy(() -> service.previewCard(trashed))
        .isInstanceOf(DriveShareLinkNotFoundException.class);

    for (String token : new String[] {"sl_nope", expired, created.token(), trashed}) {
      for (String part : new String[] {"meta", "image"}) {
        String res =
            body(
                mvc.perform(get(BASE + token + "/preview-meta?part=" + part))
                    .andExpect(status().isNoContent()));
        assertThat(res).isEmpty();
      }
    }
  }

  // --- 폴더 링크(WP-1538) ---

  @Test
  void folderLink_open_showsNameAndChildCountsAndExpiry() {
    long owner = seedUser("o");
    long spaceId = seedSpace(owner);
    long root = seedFolder(spaceId, null, "공유폴더");
    long sub = seedFolder(spaceId, root, "하위");
    long trashedSub = seedFolder(spaceId, root, "버린하위");
    seedFolder(spaceId, sub, "손자");
    seedFileIn(spaceId, root, "a.txt");
    seedFileIn(spaceId, root, "b.txt");
    long trashedFile = seedFileIn(spaceId, root, "c.txt");
    seedFileIn(spaceId, sub, "deep.txt");
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, dbNow())
        .where(DRIVE_FOLDER.ID.eq(trashedSub))
        .execute();
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, dbNow())
        .where(DRIVE_FILE.ID.eq(trashedFile))
        .execute();
    Instant expires = Instant.now().plus(3, ChronoUnit.DAYS);
    String token = folderLink(owner, root, "EXTERNAL", null, expires);
    TenantContext.clear();

    var card = (DriveSharePreview.FolderOpen) service.previewCard(token);
    // 바로 아래 살아 있는 항목만 센다(휴지통·손자·하위 파일 제외).
    assertThat(card.name()).isEqualTo("공유폴더");
    assertThat(card.folderCount()).isEqualTo(1);
    assertThat(card.fileCount()).isEqualTo(2);
    assertThat(card.expiresAt()).isNotNull();
  }

  @Test
  void folderLink_trashedSharedFolder_isNotFound() {
    long owner = seedUser("o");
    long spaceId = seedSpace(owner);
    long root = seedFolder(spaceId, null, "곧버림");
    String token = folderLink(owner, root, "EXTERNAL", null, null);
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, dbNow())
        .where(DRIVE_FOLDER.ID.eq(root))
        .execute();
    TenantContext.clear();

    assertThatThrownBy(() -> service.previewCard(token))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
  }

  @Test
  void folderLink_internalAndPassword_areFolderTypedAndHideInfo() {
    long owner = seedUser("o");
    long spaceId = seedSpace(owner);
    long root = seedFolder(spaceId, null, "비밀폴더");
    String internal = folderLink(owner, root, "INTERNAL", null, null);
    String internalPw = folderLink(owner, root, "INTERNAL", "secret", null);
    String pw = folderLink(owner, root, "EXTERNAL", "secret", null);
    TenantContext.clear();

    assertThat(service.previewCard(internal))
        .isEqualTo(new DriveSharePreview.InternalOnly(DriveShareTarget.FOLDER));
    assertThat(service.previewCard(internalPw))
        .isEqualTo(new DriveSharePreview.InternalOnly(DriveShareTarget.FOLDER));
    assertThat(service.previewCard(pw))
        .isEqualTo(new DriveSharePreview.PasswordProtected(DriveShareTarget.FOLDER));
  }

  // --- 헬퍼 ---

  private String folderLink(
      long owner, long folderId, String audience, String password, Instant expiresAt) {
    return service
        .create(
            owner,
            new DriveShareLinkService.Target.Folder(folderId),
            new CreateShareLinkRequest(audience, password, expiresAt))
        .token();
  }

  private long seedFolder(long spaceId, Long parent, String name) {
    return dsl.insertInto(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.SPACE_ID, spaceId)
        .set(DRIVE_FOLDER.PARENT_ID, parent)
        .set(DRIVE_FOLDER.NAME, name)
        .returning(DRIVE_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  /** 폴더 안에 파일을 둔다. */
  private long seedFileIn(long spaceId, long folderId, String name) {
    long id = seedFile(spaceId, name);
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.FOLDER_ID, folderId)
        .where(DRIVE_FILE.ID.eq(id))
        .execute();
    return id;
  }

  private String body(org.springframework.test.web.servlet.ResultActions r) throws Exception {
    return r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
  }

  private String link(
      long owner, long fileId, String audience, String password, Instant expiresAt) {
    return service
        .create(owner, fileId, new CreateShareLinkRequest(audience, password, expiresAt))
        .token();
  }

  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "sp_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, "sp_" + s + "@example.com")
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

  /** 같은 공간에 파일을 둘 이상 둘 때는 이름을 달리한다(공간·폴더 안 이름 유일). */
  private long seedFile(long spaceId, String name) {
    long uploadedBy = seedUser("up");
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
        .set(DRIVE_FILE.NAME, name)
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }
}
