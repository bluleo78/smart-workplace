package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** 이슈 첨부 백필 SPI 통합 테스트(WP-244) — 추출 행이 없는 첨부만 id 순으로 limit 건 반환. 클래스 트랜잭션 롤백으로 격리. */
@Transactional
class IssueAttachmentExtractionBackfillTest extends IntegrationTestBase {

  private static final long TEST_TENANT_ID = 1L;

  @Autowired DSLContext dsl;
  @Autowired IssueAttachmentService service;
  @Autowired IssueAttachmentExtractionBackfill source;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @MockitoBean WorkerClient workerClient;

  private Long ownerId;
  private String projectKey;
  private int issueNumber;
  private long projectId;

  /** FilePathBuilder 가 TenantContext 를 쓰므로 테넌트 주입 + 비공개(TEAM) 프로젝트·이슈 준비. */
  @BeforeEach
  void setUp() {
    TenantContext.set(TEST_TENANT_ID);
    ownerId = createUser("owner");
    ProjectResponse p = newProject(ownerId, "TX");
    projectKey = p.key();
    projectId = p.id();
    issueNumber = createIssue(p.id(), ownerId);
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
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  /** 기본 유형(비공개 TEAM) 프로젝트 — 비멤버 403 이 실제로 발생한다. */
  private ProjectResponse newProject(Long owner, String prefix) {
    return projectService.create(
        owner, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  /** 프로젝트의 다음 번호로 이슈 생성 — 프로젝트 안 번호를 돌려준다. */
  private int createIssue(Long projectId, Long reporter) {
    int number = 1;
    issueRepository.insert(projectId, number, "t", null, "MID", null, reporter);
    return number;
  }

  private long upload(String name, String mime) {
    List<MultipartFile> files = List.of(new MockMultipartFile("files", name, mime, "x".getBytes()));
    return service.upload(ownerId, projectKey, issueNumber, files).get(0).fileId();
  }

  /** WP-242 이전 업로드를 흉내: 업로드가 만든 추출 행을 지운다. */
  private long uploadLegacy(String name, String mime) {
    long fileId = upload(name, mime);
    dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.eq(fileId)).execute();
    return fileId;
  }

  @Test
  void 추출_행이_없는_첨부를_돌려준다() {
    long fileId = uploadLegacy("a.pdf", "application/pdf");
    assertThat(source.findMissing(100))
        .contains(new ExtractionBackfillSource.Target(fileId, "application/pdf"));
  }

  @Test
  void 행이_있는_첨부는_제외() {
    long fileId = upload("b.pdf", "application/pdf");
    assertThat(source.findMissing(100))
        .extracting(ExtractionBackfillSource.Target::fileId)
        .doesNotContain(fileId);
  }

  @Test
  void limit_을_지킨다() {
    uploadLegacy("c.txt", "text/plain");
    uploadLegacy("d.txt", "text/plain");
    assertThat(source.findMissing(1)).hasSize(1);
  }
}
