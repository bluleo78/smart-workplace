package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
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
import tools.jackson.databind.ObjectMapper;

/**
 * 스테이징 복사 {@code issue} 출처(WP-1705) 통합 테스트 — 이슈 첨부·본문 이미지를 {@code POST /staged-files/copy} 로 복사하고,
 * 읽을 수 없는 출처는 가드 예외 그대로이며 행이 남지 않는지, 복사본이 다른 프로젝트 댓글에서 그 프로젝트 권한만으로 보이는지 본다.
 */
@Transactional
class IssueStagedCopySourceTest extends IntegrationTestBase {

  private static final long TEST_TENANT_ID = 1L;

  /** PNG 매직바이트 8 + 채움 8 — ImageSniffer.HEAD_BYTES(16) 판정용. */
  private static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  @Autowired DSLContext dsl;
  @Autowired FileStore fileStore;
  @Autowired IssueService issueService;
  @Autowired IssueCommentService commentService;
  @Autowired IssueBodyImageService bodyImageService;
  @Autowired IssueAttachmentService attachmentService;
  @Autowired ProjectService projectService;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private long ownerId;
  private long p2OnlyId;
  private String p1Key;
  private String p2Key;
  private long p1IssueId;
  private long p2IssueId;
  private long origId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TEST_TENANT_ID);
    ownerId = createUser("sc-owner");
    p2OnlyId = createUser("sc-p2only");
    p1Key =
        projectService.create(ownerId, new CreateProjectRequest(uniqueKey("SA"), "P1", "x")).key();
    p2Key =
        projectService.create(ownerId, new CreateProjectRequest(uniqueKey("SB"), "P2", "x")).key();
    projectService.addMember(ownerId, p2Key, new AddMemberRequest(p2OnlyId, "MEMBER"));
    p1IssueId = issueService.create(ownerId, p1Key, createReq("p1")).id();
    p2IssueId = issueService.create(ownerId, p2Key, createReq("p2")).id();
    origId = attachmentService.upload(ownerId, p1Key, 1, List.of(png("orig.png"))).get(0).fileId();
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void 이슈_첨부를_복사하면_호출자_소유_임시_파일이_된다() throws Exception {
    mvc.perform(
            copy(
                ownerId,
                "{\"source\":\"issue\",\"issueKey\":\""
                    + p1Key
                    + "-1\",\"attachmentId\":"
                    + origId
                    + "}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("orig.png"))
        .andExpect(jsonPath("$.expiresAt").isNotEmpty());
    var copy =
        dsl.selectFrom(FILE)
            .where(FILE.UPLOADED_BY.eq(ownerId), FILE.ID.ne(origId), FILE.EXPIRES_AT.isNotNull())
            .fetchOne();
    assertThat(copy).isNotNull();
    assertThat(copy.getCategory()).isEqualTo(StagedFileClaimer.CATEGORY_ATTACHMENT);
    assertThat(copy.getId()).isNotEqualTo(origId);
    assertThat(fileStore.readAllBytes(copy.getStoragePath())).isEqualTo(PNG);
  }

  @Test
  void 본문_이미지도_복사된다() throws Exception {
    long staged = seedStaged(ownerId);
    // 본문 이미지는 이 이슈(P1-2)에 연결된다 — 첨부가 있는 P1-1 이 아니라 이미지를 가진 이슈의 키로 요청한다.
    int number =
        issueService.create(ownerId, p1Key, createReq("![x](file:" + staged + ")")).number();

    mvc.perform(
            copy(
                ownerId,
                "{\"source\":\"issue\",\"issueKey\":\""
                    + p1Key
                    + "-"
                    + number
                    + "\",\"attachmentId\":"
                    + staged
                    + "}"))
        .andExpect(status().isCreated());
    var copy =
        dsl.selectFrom(FILE)
            .where(FILE.UPLOADED_BY.eq(ownerId), FILE.ID.ne(staged), FILE.ID.ne(origId))
            .fetchOne();
    assertThat(copy).isNotNull();
    assertThat(copy.getCategory()).isEqualTo(StagedFileClaimer.CATEGORY_ATTACHMENT);
    assertThat(copy.getId()).isNotEqualTo(staged);
  }

  @Test
  void 복사본을_다른_프로젝트_댓글에_넣으면_그_프로젝트만_읽는_사용자가_이미지를_받는다() throws Exception {
    String res =
        mvc.perform(
                copy(
                    ownerId,
                    "{\"source\":\"issue\",\"issueKey\":\""
                        + p1Key
                        + "-1\",\"attachmentId\":"
                        + origId
                        + "}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    long copyId = new ObjectMapper().readTree(res).get("fileId").asLong();

    var comment =
        commentService.create(
            ownerId, p2IssueId, new CreateCommentRequest("![화면](file:" + copyId + ")"));
    assertThat(comment.body()).contains("/api/v1/projects/" + p2Key + "/issue-images/" + copyId);

    assertThat(bodyImageService.load(p2OnlyId, p2Key, copyId).mimeType()).isEqualTo("image/png");
    assertThatThrownBy(() -> attachmentService.resolveViewFileId(p2OnlyId, p1Key, 1, origId))
        .isInstanceOf(ProjectNotFoundException.class);
  }

  @Test
  void 읽을_수_없는_프로젝트의_첨부는_404_행이_생기지_않는다() throws Exception {
    mvc.perform(
            copy(
                p2OnlyId,
                "{\"source\":\"issue\",\"issueKey\":\""
                    + p1Key
                    + "-1\",\"attachmentId\":"
                    + origId
                    + "}"))
        .andExpect(status().isNotFound());
    assertThat(dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(p2OnlyId))).isZero();
  }

  @Test
  void 다른_이슈의_첨부_번호는_404_행이_생기지_않는다() throws Exception {
    issueService.create(ownerId, p1Key, createReq("두번째"));
    int before = dsl.fetchCount(FILE);
    mvc.perform(
            copy(
                ownerId,
                "{\"source\":\"issue\",\"issueKey\":\""
                    + p1Key
                    + "-2\",\"attachmentId\":"
                    + origId
                    + "}"))
        .andExpect(status().isNotFound());
    assertThat(dsl.fetchCount(FILE)).isEqualTo(before);
  }

  @Test
  void issueKey_나_attachmentId_가_없으면_400() throws Exception {
    mvc.perform(copy(ownerId, "{\"source\":\"issue\",\"issueKey\":\"" + p1Key + "-1\"}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 키_꼴이_아닌_issueKey_는_400() throws Exception {
    mvc.perform(
            copy(
                ownerId,
                "{\"source\":\"issue\",\"issueKey\":\"abc\",\"attachmentId\":" + origId + "}"))
        .andExpect(status().isBadRequest());
  }

  private MockHttpServletRequestBuilder copy(long userId, String json) {
    return post("/api/v1/staged-files/copy")
        .header(
            "Authorization",
            "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L))
        .contentType(MediaType.APPLICATION_JSON)
        .content(json);
  }

  private MockMultipartFile png(String name) {
    return new MockMultipartFile("files", name, "image/png", PNG);
  }

  private long seedStaged(long uploader) {
    String path = "tenant-1/staged/" + UUID.randomUUID();
    fileStore.storeBytes(path, PNG);
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "body.png")
        .set(FILE.STORED_NAME, path)
        .set(FILE.STORAGE_PATH, path)
        .set(FILE.MIME_TYPE, "image/png")
        .set(FILE.SIZE_BYTES, (long) PNG.length)
        .set(FILE.CATEGORY, StagedFileClaimer.CATEGORY_ATTACHMENT)
        .set(FILE.UPLOADED_BY, uploader)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().plusHours(24))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  private CreateIssueRequest createReq(String body) {
    return new CreateIssueRequest("복사", body, null, null, null, null, null, null);
  }

  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, TEST_TENANT_ID)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return prefix + suffix;
  }
}
