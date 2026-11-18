package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 스테이징 복사 {@code drive} 출처(WP-1705) 통합 테스트 — 드라이브 파일의 현재 버전을 {@code POST /staged-files/copy} 로
 * 복사하고, 공간 멤버가 아니거나 휴지통에 있는 파일은 가드 예외 그대로이며 FILE 행이 남지 않는지 본다.
 */
@Transactional
class DriveStagedCopySourceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired FileStore fileStore;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 드라이브_파일을_복사하면_현재_버전_바이트의_임시_파일이_된다() throws Exception {
    long u = seedUser();
    var sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = upload(u, sp.id(), "메모.txt", "v1");
    // 새 버전을 올린다 — 복사는 최신 버전 바이트여야 한다.
    fileService.updateTextFile(u, f.id(), "v2-latest", null);

    mvc.perform(copy(u, "{\"source\":\"drive\",\"driveFileId\":" + f.id() + "}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("메모.txt"))
        .andExpect(jsonPath("$.expiresAt").isNotEmpty());

    var copy =
        dsl.selectFrom(FILE).where(FILE.UPLOADED_BY.eq(u), FILE.EXPIRES_AT.isNotNull()).fetchOne();
    assertThat(copy).isNotNull();
    assertThat(copy.getCategory()).isEqualTo(StagedFileClaimer.CATEGORY_ATTACHMENT);
    assertThat(fileStore.readAllBytes(copy.getStoragePath()))
        .isEqualTo("v2-latest".getBytes(StandardCharsets.UTF_8));
  }

  /**
   * 드라이브의 html·svg 는 원본 응답에 CSP sandbox 가 붙어 그 MIME 으로 두지만, 스테이징 복사본은 이슈·챗·노트 첨부가 되므로 text/plain 으로
   * 바꿔 저장한다 — 그 첨부 원본 경로에서 문서로 렌더링되지 않게.
   */
  @Test
  void html_svg_드라이브_파일의_복사본은_text_plain() throws Exception {
    long u = seedUser();
    var sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse html = upload(u, sp.id(), "page.html", "<script>1</script>", "text/html");
    DriveFileResponse svg = upload(u, sp.id(), "pic.svg", "<svg/>", "image/svg+xml");
    assertThat(html.mimeType()).isEqualTo("text/html");
    assertThat(svg.mimeType()).isEqualTo("image/svg+xml");

    mvc.perform(copy(u, "{\"source\":\"drive\",\"driveFileId\":" + html.id() + "}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.mimeType").value("text/plain"));
    mvc.perform(copy(u, "{\"source\":\"drive\",\"driveFileId\":" + svg.id() + "}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.mimeType").value("text/plain"));
  }

  @Test
  void 공간_멤버가_아니면_거절되고_행이_생기지_않는다() throws Exception {
    long owner = seedUser();
    long outsider = seedUser();
    var sp = spaceService.createTeamSpace(owner, "팀");
    DriveFileResponse f = upload(owner, sp.id(), "비밀.txt", "x");

    // 가드는 비멤버를 없는 파일과 같은 404 로 숨긴다(파일 id 존재 은닉).
    mvc.perform(copy(outsider, "{\"source\":\"drive\",\"driveFileId\":" + f.id() + "}"))
        .andExpect(status().isNotFound());
    assertThat(dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(outsider))).isZero();
  }

  @Test
  void 휴지통의_파일은_404_행이_생기지_않는다() throws Exception {
    long u = seedUser();
    var sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = upload(u, sp.id(), "버림.txt", "x");
    fileService.delete(u, f.id());
    int before = dsl.fetchCount(FILE);

    mvc.perform(copy(u, "{\"source\":\"drive\",\"driveFileId\":" + f.id() + "}"))
        .andExpect(status().isNotFound());
    assertThat(dsl.fetchCount(FILE)).isEqualTo(before);
  }

  @Test
  void driveFileId_가_없으면_400() throws Exception {
    long u = seedUser();
    mvc.perform(copy(u, "{\"source\":\"drive\"}")).andExpect(status().isBadRequest());
  }

  private DriveFileResponse upload(long u, long spaceId, String name, String body)
      throws Exception {
    return upload(u, spaceId, name, body, "text/plain");
  }

  private DriveFileResponse upload(long u, long spaceId, String name, String body, String mime)
      throws Exception {
    return fileService.upload(
        u,
        spaceId,
        null,
        new MockMultipartFile("file", name, mime, body.getBytes(StandardCharsets.UTF_8)));
  }

  private MockHttpServletRequestBuilder copy(long userId, String json) {
    return post("/api/v1/staged-files/copy")
        .header(
            "Authorization",
            "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L))
        .contentType(MediaType.APPLICATION_JSON)
        .content(json);
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ds_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Ds" + s)
            .set(USER.EMAIL, "ds_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }
}
