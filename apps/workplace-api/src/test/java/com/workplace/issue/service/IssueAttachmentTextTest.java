package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.exception.AttachmentNotFoundException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
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

/**
 * 이슈 첨부 텍스트 추출 통합 테스트(WP-242) — 업로드 시 TEXT_ONLY 추출 행 생성, 목록 extraction, 구간 읽기와 권한·소속 가드. 클래스 트랜잭션
 * 롤백으로 공유 DB 를 오염시키지 않는다(AFTER_COMMIT 워커 디스패치는 롤백이라 발화하지 않음).
 */
@Transactional
class IssueAttachmentTextTest extends IntegrationTestBase {

  private static final long TEST_TENANT_ID = 1L;

  @Autowired DSLContext dsl;
  @Autowired IssueAttachmentService service;
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

  private long uploadPdf() {
    List<MultipartFile> files =
        List.of(new MockMultipartFile("files", "a.pdf", "application/pdf", "%PDF-1.4".getBytes()));
    return service.upload(ownerId, projectKey, issueNumber, files).get(0).fileId();
  }

  private void markDone(long fileId, String text) {
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
        .set(FILE_EXTRACTION.CHAR_COUNT, text.codePointCount(0, text.length()))
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .execute();
  }

  private String statusOf(long fileId) {
    return dsl.select(FILE_EXTRACTION.STATUS)
        .from(FILE_EXTRACTION)
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .fetchOne(FILE_EXTRACTION.STATUS);
  }

  private String profileOf(long fileId) {
    return dsl.select(FILE_EXTRACTION.PROFILE)
        .from(FILE_EXTRACTION)
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .fetchOne(FILE_EXTRACTION.PROFILE);
  }

  @Test
  void 업로드하면_TEXT_ONLY_추출_행이_생기고_목록에_PENDING() {
    List<MultipartFile> files =
        List.of(new MockMultipartFile("files", "a.pdf", "application/pdf", "%PDF-1.4".getBytes()));
    var added = service.upload(ownerId, projectKey, issueNumber, files);
    long fileId = added.get(0).fileId();

    var list = service.list(ownerId, projectKey, issueNumber);
    assertThat(list.get(0).extraction().status()).isEqualTo("PENDING");
    assertThat(profileOf(fileId)).isEqualTo("TEXT_ONLY");
  }

  @Test
  void octet_stream_으로_올린_대문자_PDF_도_추출_대상() {
    List<MultipartFile> files =
        List.of(
            new MockMultipartFile(
                "files", "REPORT.PDF", "application/octet-stream", "%PDF".getBytes()));
    long fileId = service.upload(ownerId, projectKey, issueNumber, files).get(0).fileId();
    assertThat(service.list(ownerId, projectKey, issueNumber).get(0).mimeType())
        .isEqualTo("application/pdf");
    assertThat(statusOf(fileId)).isEqualTo("PENDING");
  }

  @Test
  void 이미지는_SKIPPED_사유_IMAGE() {
    List<MultipartFile> files =
        List.of(new MockMultipartFile("files", "a.png", "image/png", new byte[] {1, 2}));
    service.upload(ownerId, projectKey, issueNumber, files);
    var ex = service.list(ownerId, projectKey, issueNumber).get(0).extraction();
    assertThat(ex.status()).isEqualTo("SKIPPED");
    assertThat(ex.reasonCode()).isEqualTo("IMAGE");
  }

  @Test
  void 구간_읽기는_추출된_텍스트를_돌려준다() {
    long fileId = uploadPdf();
    markDone(fileId, "가나다라마");
    var s = service.readText(ownerId, projectKey, issueNumber, fileId, 1, 2);
    assertThat(s.text()).isEqualTo("나다");
    assertThat(s.nextOffset()).isEqualTo(3);
  }

  @Test
  void 다른_이슈의_fileId_는_404() {
    long fileId = uploadPdf();
    issueRepository.insert(projectId, 2, "t2", null, "MID", null, ownerId);
    assertThatThrownBy(() -> service.readText(ownerId, projectKey, 2, fileId, 0, 10))
        .isInstanceOf(AttachmentNotFoundException.class);
    assertThatThrownBy(
            () -> service.readText(ownerId, projectKey, issueNumber, 999_999_999L, 0, 10))
        .isInstanceOf(AttachmentNotFoundException.class);
  }

  @Test
  void 비공개_프로젝트_비멤버는_403() {
    long fileId = uploadPdf();
    Long outsider = createUser("outsider");
    assertThatThrownBy(() -> service.readText(outsider, projectKey, issueNumber, fileId, 0, 10))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }
}
