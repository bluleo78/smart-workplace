package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 폴더 공유 링크 하위 파일 content·preview·download(WP-1538) HTTP 통합 테스트.
 *
 * <p>핵심: 공유 폴더 밖 파일(형제·공간 루트·다른 테넌트·휴지통·밖으로 옮긴 폴더)은 모두 404, 폴더 하위 파일 경로는 열람 토큰만 받고(비밀번호 헤더 무시, P7),
 * 파일 전용 경로는 폴더 링크를 비밀번호 검증 <b>전</b>에 404 로 돌려 시도 칸을 쓰지 않는다. 픽스처는 {@link DriveFolderShareViewTest} 와
 * 같은 트리이고, 파일은 실제 바이트가 든 임시 파일로 둔다.
 */
@Transactional
class DriveFolderShareFileTest extends IntegrationTestBase {
  private static final String BASE = "/api/v1/public/drive/share/";

  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkService service;
  @Autowired MockMvc mockMvc;
  @Autowired JwtTokenProvider jwt;

  private final List<String> tokenHashes = new ArrayList<>();
  private final List<Path> blobs = new ArrayList<>();

  private long owner;
  private long spaceId;
  private long p;
  private long root;
  private long a;
  private long a1;
  private long sibling;
  private long f1;
  private long deep;
  private long aFile;
  private long siblingFile;
  private long topFile;

  @BeforeEach
  void seed() throws IOException {
    TenantContext.set(1L);
    owner = seedUser("공유자");
    spaceId = seedSpace(owner);
    p = seedFolder(spaceId, null, "P");
    root = seedFolder(spaceId, p, "root");
    a = seedFolder(spaceId, root, "A");
    a1 = seedFolder(spaceId, a, "A1");
    sibling = seedFolder(spaceId, p, "sibling");
    f1 = seedFile(spaceId, root, "f1.txt", "text/plain", "root-file");
    aFile = seedFile(spaceId, a, "a.txt", "text/plain", "a-file");
    deep = seedFile(spaceId, a1, "deep.txt", "text/plain", "deep-bytes");
    siblingFile = seedFile(spaceId, sibling, "s.txt", "text/plain", "s");
    topFile = seedFile(spaceId, null, "top.txt", "text/plain", "top");
  }

  @AfterEach
  void cleanup() throws IOException {
    TenantContext.clear();
    if (!tokenHashes.isEmpty()) {
      dsl.deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
          .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.in(tokenHashes))
          .execute();
      tokenHashes.clear();
    }
    for (Path b : blobs) {
      Files.deleteIfExists(b);
    }
    blobs.clear();
  }

  // --- 정상 경로 ---

  @Test
  void descendantFile_download200_attachment() throws Exception {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    mockMvc
        .perform(get(BASE + token + "/files/" + deep + "/download"))
        .andExpect(status().isOk())
        .andExpect(
            header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("attachment")))
        .andExpect(content().bytes("deep-bytes".getBytes(StandardCharsets.UTF_8)));
  }

  @Test
  void descendantFile_content200_sandboxHeaders() throws Exception {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    mockMvc
        .perform(get(BASE + token + "/files/" + deep + "/content"))
        .andExpect(status().isOk())
        .andExpect(
            header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("inline")))
        .andExpect(header().string("X-Content-Type-Options", "nosniff"))
        .andExpect(header().string("Content-Security-Policy", "sandbox"))
        .andExpect(content().bytes("deep-bytes".getBytes(StandardCharsets.UTF_8)));
  }

  @Test
  void descendantFile_preview_contract() throws Exception {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    // 오피스가 아닌 txt — 기존 /preview 와 같은 PreviewResponses 의 NOT_APPLICABLE 404 본문
    mockMvc
        .perform(get(BASE + token + "/files/" + deep + "/preview").param("start", "true"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.status").value("NOT_APPLICABLE"));
  }

  // --- 비밀번호(P7) ---

  @Test
  void passwordLink_withViewToken_200_withoutToken401() throws Exception {
    String token = folderLink("EXTERNAL", "secret");
    TenantContext.clear();
    String vt = service.unlock(token, "secret", null, false).viewToken();
    TenantContext.clear();

    mockMvc
        .perform(
            get(BASE + token + "/files/" + deep + "/download").header("X-Share-View-Token", vt))
        .andExpect(status().isOk());
    mockMvc
        .perform(get(BASE + token + "/files/" + deep + "/download"))
        .andExpect(status().isUnauthorized());
    mockMvc
        .perform(get(BASE + token + "/files/" + deep + "/content"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void passwordLink_passwordHeaderIgnored_401() throws Exception {
    String token = folderLink("EXTERNAL", "secret");
    TenantContext.clear();
    mockMvc
        .perform(
            get(BASE + token + "/files/" + deep + "/download").header("X-Share-Password", "secret"))
        .andExpect(status().isUnauthorized());
  }

  // --- 밖 파일 404 ---

  @Test
  void outsideFile_sibling_404() throws Exception {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    assertAllRoutes404(token, siblingFile);
  }

  @Test
  void spaceRootFile_404() throws Exception {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    assertAllRoutes404(token, topFile);
    assertAllRoutes404(token, Long.MAX_VALUE);
  }

  @Test
  void otherTenantFileId_404() throws Exception {
    long t2 = ensureFixtureTenant("wp1538-folder-share-file-other");
    String token = folderLink("EXTERNAL", null);
    useTenant(t2);
    long t2Space = seedSpace(owner);
    long t2Folder = seedFolder(t2Space, null, "t2");
    long t2File = seedFile(t2Space, t2Folder, "t2.txt", "text/plain", "t2");
    useTenant(1L);
    TenantContext.clear();
    assertAllRoutes404(token, t2File);
  }

  @Test
  void trashedFile_404() throws Exception {
    String token = folderLink("EXTERNAL", null);
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, dbNow())
        .where(DRIVE_FILE.ID.eq(f1))
        .execute();
    TenantContext.clear();
    assertAllRoutes404(token, f1);
  }

  @Test
  void fileInTrashedSubfolder_404() throws Exception {
    String token = folderLink("EXTERNAL", null);
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, dbNow())
        .where(DRIVE_FOLDER.ID.eq(a))
        .execute();
    TenantContext.clear();
    assertAllRoutes404(token, aFile);
    assertAllRoutes404(token, deep);
  }

  @Test
  void fileOfMovedOutsideFolder_404() throws Exception {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    mockMvc.perform(get(BASE + token + "/files/" + deep + "/download")).andExpect(status().isOk());

    TenantContext.set(1L);
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.PARENT_ID, sibling)
        .where(DRIVE_FOLDER.ID.eq(a1))
        .execute();
    TenantContext.clear();
    assertAllRoutes404(token, deep);
  }

  // --- 링크 가드 ---

  @Test
  void internal_otherTenant_403_anonymous_401() throws Exception {
    long t2 = ensureFixtureTenant("wp1538-folder-share-file-other");
    String token = folderLink("INTERNAL", null);
    // JWT 필터는 활성 멤버십이 있는 테넌트만 받는다 — 두 워크스페이스 모두 구성원으로 둔다.
    withMembership(owner);
    baseDsl
        .insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, owner)
        .set(MEMBERSHIP.TENANT_ID, t2)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .onConflictDoNothing()
        .execute();
    TenantContext.clear();
    String url = BASE + token + "/files/" + deep + "/download";

    mockMvc.perform(get(url)).andExpect(status().isUnauthorized());
    mockMvc
        .perform(
            get(url).header("Authorization", "Bearer " + jwt.generateAccessToken(owner, "x", t2)))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(
            get(url).header("Authorization", "Bearer " + jwt.generateAccessToken(owner, "x", 1L)))
        .andExpect(status().isOk());
  }

  @Test
  void revoked_410_expired_410() throws Exception {
    var created =
        service.create(
            owner,
            new DriveShareLinkService.Target.Folder(root),
            new CreateShareLinkRequest("EXTERNAL", null, null));
    tokenHashes.add(CapabilityTokens.sha256Hex(created.token()));
    service.revoke(owner, created.id());
    String expired = folderLink("EXTERNAL", null);
    dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.EXPIRES_AT, dbNow().minusDays(1))
        .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(expired)))
        .execute();
    TenantContext.clear();
    for (String t : new String[] {created.token(), expired}) {
      for (String route : new String[] {"/content", "/preview", "/download"}) {
        mockMvc.perform(get(BASE + t + "/files/" + deep + route)).andExpect(status().isGone());
      }
    }
  }

  // --- 링크 종류 불일치 ---

  @Test
  void fileLink_filesPath_404() throws Exception {
    String token = fileLink(f1, "EXTERNAL", null);
    TenantContext.clear();
    assertAllRoutes404(token, f1);
    assertAllRoutes404(token, deep);
  }

  @Test
  void folderLink_contentAndDownload_404() throws Exception {
    String token = folderLink("EXTERNAL", null);
    TenantContext.clear();
    mockMvc.perform(get(BASE + token + "/content")).andExpect(status().isNotFound());
    mockMvc.perform(get(BASE + token + "/download")).andExpect(status().isNotFound());
    mockMvc.perform(get(BASE + token + "/preview")).andExpect(status().isNotFound());
  }

  @Test
  void folderLink_downloadWithPasswordHeader_404_withoutConsumingAttempt() throws Exception {
    String token = folderLink("EXTERNAL", "secret");
    TenantContext.clear();
    for (int i = 0; i < 7; i++) {
      mockMvc
          .perform(get(BASE + token + "/download").header("X-Share-Password", "wrong"))
          .andExpect(status().isNotFound());
    }
    mockMvc
        .perform(get(BASE + token + "/download").header("X-Share-Password", "secret"))
        .andExpect(status().isNotFound());
    // 시도 칸이 한 번도 쓰이지 않았다 — 행이 없다
    assertThat(
            dsl.fetchCount(
                DRIVE_SHARE_LINK_ATTEMPTS,
                DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(token))))
        .isZero();
  }

  // --- 헬퍼 ---

  /** content·preview·download 세 경로 모두 404 인지. */
  private void assertAllRoutes404(String token, long driveFileId) throws Exception {
    for (String route : new String[] {"/content", "/preview", "/download"}) {
      ResultActions r = mockMvc.perform(get(BASE + token + "/files/" + driveFileId + route));
      r.andExpect(status().isNotFound());
    }
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
        .set(USER.USERNAME, "ff_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, "ff_" + s + "@example.com")
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

  /** 실제 바이트가 든 임시 파일을 저장 경로(절대 경로, 레거시 호환)로 두고 file·drive_file 행을 넣는다. */
  private long seedFile(long space, Long folder, String name, String mime, String body)
      throws IOException {
    Path blob = Files.createTempFile("wp1538-", ".bin");
    Files.write(blob, body.getBytes(StandardCharsets.UTF_8));
    blobs.add(blob);
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, name)
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, blob.toString())
            .set(FILE.MIME_TYPE, mime)
            .set(FILE.SIZE_BYTES, (long) body.length())
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
