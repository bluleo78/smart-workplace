package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.AttachmentLimitExceededException;
import com.workplace.issue.exception.AttachmentTooLargeException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 첨부 클레임(WP-422) 통합 테스트 — 먼저 올려 둔 스테이징 파일을 이슈에 묶는 API와 이슈 생성 요청의 fileIds. 클래스 트랜잭션 롤백으로 공유 DB 를
 * 오염시키지 않는다. 생성 중 실패 시 이슈가 남지 않는지는 세이브포인트(NESTED) 트랜잭션으로 확인한다.
 */
@Transactional
class IssueAttachmentClaimTest extends IntegrationTestBase {

  private static final long TEST_TENANT_ID = 1L;

  @Autowired DSLContext dsl;
  @Autowired IssueAttachmentService service;
  @Autowired IssueService issueService;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired ProjectService projectService;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ObjectMapper objectMapper;

  private Long ownerId;
  private String projectKey;
  private long projectId;
  private long issueId;
  private int issueNumber;

  @BeforeEach
  void setUp() {
    TenantContext.set(TEST_TENANT_ID);
    ownerId = createUser("owner");
    ProjectResponse p =
        projectService.create(ownerId, new CreateProjectRequest(uniqueKey("CL"), "P-claim", "x"));
    projectKey = p.key();
    projectId = p.id();
    // 시퀀스로 번호를 받는 정식 생성 경로를 쓴다(수동 번호는 이슈 생성의 시퀀스와 충돌).
    var issue =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("t", null, null, null, null, null, null, null));
    issueId = issue.id();
    issueNumber = issue.number();
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
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
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  private String tokenFor(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  /** 텍스트 스테이징 파일을 만든다(POST /staged-files/text) — 응답의 fileId. 요청 필터가 지운 테넌트 컨텍스트를 되돌린다. */
  private long stage(long caller, String name) throws Exception {
    String body =
        mvc.perform(
                post("/api/v1/staged-files/text")
                    .header("Authorization", tokenFor(caller))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        objectMapper.writeValueAsString(Map.of("name", name, "content", "내용"))))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    TenantContext.set(TEST_TENANT_ID);
    return objectMapper.readTree(body).get("fileId").asLong();
  }

  private List<Long> stageMany(int n) throws Exception {
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      ids.add(stage(ownerId, "f" + i + ".txt"));
    }
    return ids;
  }

  private int attachmentCount() {
    return service.listByIssueId(issueId).size();
  }

  @Test
  void 스테이징_파일을_클레임하면_첨부_목록에_보이고_영구가_된다() throws Exception {
    long fileId = stage(ownerId, "memo.txt");

    var added = service.claim(ownerId, projectKey, issueNumber, List.of(fileId));

    assertThat(added).extracting("fileId").containsExactly(fileId);
    assertThat(service.list(ownerId, projectKey, 1))
        .singleElement()
        .satisfies(
            a -> {
              assertThat(a.fileId()).isEqualTo(fileId);
              assertThat(a.originalName()).isEqualTo("memo.txt");
            });
    assertThat(dsl.select(FILE.EXPIRES_AT).from(FILE).where(FILE.ID.eq(fileId)).fetchOne(0))
        .isNull();
    assertThat(historyRepository.findByIssue(issueId))
        .filteredOn(h -> "ATTACHMENTS_CHANGED".equals(h.eventType()))
        .hasSize(1);
    assertThat(
            dsl.select(FILE_EXTRACTION.PROFILE)
                .from(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                .fetchOne(FILE_EXTRACTION.PROFILE))
        .isEqualTo("TEXT_ONLY");
  }

  @Test
  void HTTP_클레임은_200_과_첨부_목록을_돌려준다() throws Exception {
    long fileId = stage(ownerId, "http.txt");

    mvc.perform(
            post("/api/v1/projects/" + projectKey + "/issues/" + issueNumber + "/attachments/claim")
                .header("Authorization", tokenFor(ownerId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("fileIds", List.of(fileId)))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fileId").value(fileId))
        .andExpect(jsonPath("$[0].originalName").value("http.txt"));
  }

  @Test
  void 빈_목록과_11개_요청은_400() throws Exception {
    for (List<Long> ids : List.of(List.<Long>of(), stageMany(11))) {
      mvc.perform(
              post("/api/v1/projects/"
                      + projectKey
                      + "/issues/"
                      + issueNumber
                      + "/attachments/claim")
                  .header("Authorization", tokenFor(ownerId))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(objectMapper.writeValueAsString(Map.of("fileIds", ids))))
          .andExpect(status().isBadRequest());
    }
  }

  /** 이슈 생성 요청의 fileIds 도 한 요청 10개까지 — 11개면 검증(400)에서 막혀 이슈가 생기지 않는다. */
  @Test
  void 생성_요청의_fileIds_11개는_400_이슈도_생기지_않음() throws Exception {
    List<Long> eleven = new ArrayList<>();
    for (long i = 1; i <= 11; i++) {
      eleven.add(i);
    }
    int before = dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId));
    mvc.perform(
            post("/api/v1/projects/" + projectKey + "/issues")
                .header("Authorization", tokenFor(ownerId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(Map.of("title", "많은 첨부", "fileIds", eleven))))
        .andExpect(status().isBadRequest());
    TenantContext.set(TEST_TENANT_ID);
    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isEqualTo(before);
  }

  @Test
  void 열한_번째는_409_아무것도_묶이지_않음() throws Exception {
    service.claim(ownerId, projectKey, issueNumber, stageMany(9));
    List<Long> two = stageMany(2);

    assertThatThrownBy(() -> service.claim(ownerId, projectKey, issueNumber, two))
        .isInstanceOf(AttachmentLimitExceededException.class);

    assertThat(attachmentCount()).isEqualTo(9);
    // 거절된 파일은 여전히 임시(만료 있음)로 남아 다시 쓸 수 있다.
    assertThat(dsl.fetchCount(FILE, FILE.ID.in(two).and(FILE.EXPIRES_AT.isNotNull()))).isEqualTo(2);
  }

  @Test
  void 남의_스테이징_파일은_400() throws Exception {
    Long other = createUser("other");
    long fileId = stage(other, "theirs.txt");

    assertThatThrownBy(() -> service.claim(ownerId, projectKey, issueNumber, List.of(fileId)))
        .isInstanceOf(StagedFileUnusableException.class);
    assertThat(attachmentCount()).isZero();
  }

  @Test
  void 이미_다른_이슈에_붙은_파일은_400() throws Exception {
    long fileId = stage(ownerId, "once.txt");
    service.claim(ownerId, projectKey, issueNumber, List.of(fileId));
    var second =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("t2", null, null, null, null, null, null, null));

    assertThatThrownBy(() -> service.claim(ownerId, projectKey, second.number(), List.of(fileId)))
        .isInstanceOf(StagedFileUnusableException.class);
    assertThat(service.listByIssueId(second.id())).isEmpty();
  }

  @Test
  void 비멤버_비reporter_는_403() throws Exception {
    Long outsider = createUser("outsider");
    long fileId = stage(outsider, "x.txt");

    assertThatThrownBy(() -> service.claim(outsider, projectKey, issueNumber, List.of(fileId)))
        .isInstanceOf(ProjectNotFoundException.class);
  }

  @Test
  void 파일_크기가_첨부_상한을_넘으면_400_이고_묶이지_않음() throws Exception {
    long fileId = stage(ownerId, "big.txt");
    // 스테이징 링크 상한과 첨부 상한이 어긋나는 상황을 만든다 — 크기만 상한 위로 바꾼다.
    dsl.update(FILE).set(FILE.SIZE_BYTES, 26_214_401L).where(FILE.ID.eq(fileId)).execute();

    assertThatThrownBy(() -> service.claim(ownerId, projectKey, issueNumber, List.of(fileId)))
        .isInstanceOf(AttachmentTooLargeException.class);
  }

  @Test
  void 생성_요청의_fileIds_는_같은_트랜잭션에서_붙고_잘못된_id_면_이슈도_생기지_않는다() throws Exception {
    long good = stage(ownerId, "created.txt");

    var created = issueService.create(ownerId, projectKey, requestWithFiles(List.of(good)));

    assertThat(service.listByIssueId(created.id())).extracting("fileId").containsExactly(good);

    int before = dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId));
    long bogus = 999_999_999L;
    // 세이브포인트 안에서 실패시켜 롤백 범위를 확인한다 — 이슈 INSERT 가 되돌아가야 한다.
    var nested = new TransactionTemplate(txManager);
    nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    assertThatThrownBy(
            () ->
                nested.executeWithoutResult(
                    st ->
                        issueService.create(ownerId, projectKey, requestWithFiles(List.of(bogus)))))
        .isInstanceOf(StagedFileUnusableException.class);
    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isEqualTo(before);
  }

  private CreateIssueRequest requestWithFiles(List<Long> fileIds) {
    return new CreateIssueRequest(
        "첨부와 함께", "본문", "MID", null, null, null, null, null, null, null, null, null, fileIds);
  }

  /** 업로드 경로와 클레임 경로가 같은 이슈 안에서 섞여도 한도를 함께 센다. */
  @Test
  void 업로드와_클레임이_섞여도_한도는_합산() throws Exception {
    List<MultipartFile> nine = new ArrayList<>();
    for (int i = 0; i < 9; i++) {
      nine.add(new MockMultipartFile("files", "u" + i + ".txt", "text/plain", new byte[] {1}));
    }
    service.upload(ownerId, projectKey, issueNumber, nine);
    List<Long> two = stageMany(2);

    assertThatThrownBy(() -> service.claim(ownerId, projectKey, issueNumber, two))
        .isInstanceOf(AttachmentLimitExceededException.class);
  }
}
