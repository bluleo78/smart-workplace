package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.AttachmentLimitExceededException;
import com.workplace.issue.exception.AttachmentTooLargeException;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.file.Files;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** IssueAttachmentService 통합 테스트 — 멤버/사이즈/한도/권한 게이트 + history 기록. */
@Transactional
class IssueAttachmentServiceTest extends IntegrationTestBase {

  /** 테스트 테넌트 ID — connection-init-sql 의 app.tenant_id=1 과 일치. */
  private static final long TEST_TENANT_ID = 1L;

  @Autowired DSLContext dsl;
  @Autowired IssueAttachmentService service;
  @Autowired IssueAttachmentStorage storage;
  @Autowired IssueAttachmentRepository repo;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired ProjectService projectService;

  /**
   * FilePathBuilder 가 TenantContext.get() 을 사용하므로 테스트 시작 전 테넌트를 설정. connection-init-sql 의
   * GUC(app.tenant_id=1) 와 동일한 값을 Java ThreadLocal 에도 주입.
   */
  @BeforeEach
  void setUpTenantContext() {
    TenantContext.set(TEST_TENANT_ID);
  }

  /** 테스트 종료 후 ThreadLocal 정리 — 다른 테스트로 누수 방지. */
  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  /** USER + USER_ROLE 직접 INSERT — Phase 3a IssueLabelServiceTest 패턴. */
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
    // 테넌트#1 ACTIVE 멤버십 — MembershipGuard(#713) 가 addMember 대상의 테넌트 소속을 검증하므로 필요.
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

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  private MultipartFile mockFile(String name, byte[] body) {
    return new MockMultipartFile("files", name, "application/octet-stream", body);
  }

  @Test
  void member_uploads_one_file_records_history() throws IOException {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "AT");
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    var result =
        service.upload(owner, p.key(), 1, List.of(mockFile("a.txt", new byte[] {1, 2, 3})));

    assertThat(result).hasSize(1);
    assertThat(result.get(0).originalName()).isEqualTo("a.txt");
    assertThat(historyRepository.findByIssue(issue.id()))
        .anyMatch(h -> "ATTACHMENTS_CHANGED".equals(h.eventType()));
  }

  @Test
  void storage_path_is_relative_with_tenant_prefix() throws IOException {
    // STORAGE_PATH 에는 절대경로가 아닌 tenant-{id}/issue/{date}/... 상대경로가 저장돼야 한다.
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "RP");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    service.upload(owner, p.key(), 1, List.of(mockFile("hello.txt", new byte[] {7, 8, 9})));

    Long fileId =
        repo.findByIssue(issueRepository.findByProjectAndNumber(p.id(), 1).orElseThrow().id())
            .get(0)
            .fileId();

    String storedPath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchOne(FILE.STORAGE_PATH);

    // 상대경로: tenant-1/issue/yyyy-MM-dd/uuid.txt 패턴
    assertThat(storedPath)
        .startsWith("tenant-" + TEST_TENANT_ID + "/issue/")
        .doesNotStartWith("/"); // 절대경로 아님
  }

  @Test
  void upload_download_byte_roundtrip() throws IOException {
    // 업로드한 파일 바이너리를 다운로드 경로를 통해 그대로 읽을 수 있어야 한다.
    byte[] content = new byte[] {10, 20, 30, 40, 50};
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "RT");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    service.upload(owner, p.key(), 1, List.of(mockFile("data.bin", content)));

    Long fileId =
        repo.findByIssue(issueRepository.findByProjectAndNumber(p.id(), 1).orElseThrow().id())
            .get(0)
            .fileId();

    // load() 가 반환하는 path() 는 FileStore.resolve() 를 거친 절대경로여야 한다.
    IssueAttachmentStorage.StoredFile sf = storage.load(fileId);
    assertThat(sf.path().isAbsolute()).isTrue();
    assertThat(Files.readAllBytes(sf.path())).isEqualTo(content);
  }

  @Test
  void file_exceeds_25mb_throws_400() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "AT");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    byte[] huge = new byte[26 * 1024 * 1024]; // 26MB
    assertThatThrownBy(() -> service.upload(owner, p.key(), 1, List.of(mockFile("big.bin", huge))))
        .isInstanceOf(AttachmentTooLargeException.class);
  }

  @Test
  void over_10_per_issue_throws_409() throws IOException {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "AT");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    // 1차로 9개 업로드 → OK
    List<MultipartFile> nine =
        java.util.stream.IntStream.range(0, 9)
            .mapToObj(i -> mockFile("f" + i + ".txt", new byte[] {1}))
            .toList();
    service.upload(owner, p.key(), 1, nine);

    // 2개 추가 시도 → 누적 11 → 409
    assertThatThrownBy(
            () ->
                service.upload(
                    owner,
                    p.key(),
                    1,
                    List.of(mockFile("x.txt", new byte[] {1}), mockFile("y.txt", new byte[] {1}))))
        .isInstanceOf(AttachmentLimitExceededException.class);
  }

  @Test
  void non_member_upload_forbidden() {
    Long owner = createUser("owner");
    Long stranger = createUser("stranger");
    ProjectResponse p = newProject(owner, "AT");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(
            () -> service.upload(stranger, p.key(), 1, List.of(mockFile("a.txt", new byte[] {1}))))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void uploader_can_delete_owner_can_delete_other_member_cannot() throws IOException {
    Long owner = createUser("owner");
    Long memberA = createUser("memberA");
    Long memberB = createUser("memberB");
    ProjectResponse p = newProject(owner, "AT");
    projectService.addMember(owner, p.key(), new AddMemberRequest(memberA, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(memberB, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    // memberA 가 2개 첨부
    var attached =
        service.upload(
            memberA,
            p.key(),
            1,
            List.of(mockFile("a.txt", new byte[] {1}), mockFile("b.txt", new byte[] {2})));
    Long fileA = attached.get(0).fileId();
    Long fileB = attached.get(1).fileId();

    // 첨부자 본인 OK
    service.delete(memberA, p.key(), 1, fileA);

    // 다른 멤버 (첨부자도 OWNER도 아님) → 403
    assertThatThrownBy(() -> service.delete(memberB, p.key(), 1, fileB))
        .isInstanceOf(ProjectAccessDeniedException.class);

    // OWNER OK
    service.delete(owner, p.key(), 1, fileB);
  }

  /** OPEN 프로젝트 생성 — 비멤버 테넌트 사용자도 이슈 생성·조회가 가능한 유형(WP-202). */
  private ProjectResponse newOpenProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x", "OPEN"));
  }

  /**
   * WP-202 회귀: OPEN 프로젝트에서 비멤버가 자기 이슈(reporter 본인)에 첨부하면 본문 편집 권한과 동일하게 허용돼야 한다. 예전엔 업로드가
   * assertMember 라 비멤버 reporter 만 "프로젝트 멤버가 아닙니다" 403 을 받아 사용자마다 결과가 달랐다.
   */
  @Test
  void open_project_non_member_reporter_can_upload_download_and_delete_own() {
    Long owner = createUser("owner");
    Long reporter = createUser("reporter");
    ProjectResponse p = newOpenProject(owner, "OA");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, reporter);

    var added =
        service.upload(reporter, p.key(), 1, List.of(mockFile("photo.png", new byte[] {1, 2})));
    assertThat(added).hasSize(1);
    Long fileId = added.get(0).fileId();

    // 업로드한 본인이 내려받고 지울 수 있어야 한다(목록은 이미 assertReadable 로 열려 있음).
    assertThat(service.download(reporter, p.key(), 1, fileId).originalName())
        .isEqualTo("photo.png");
    service.delete(reporter, p.key(), 1, fileId);
    assertThat(service.list(reporter, p.key(), 1)).isEmpty();
  }

  /** WP-202: OPEN 프로젝트의 비멤버 열람자는 남의 이슈에 첨부할 수 없지만(본문 편집 불가와 동일) 첨부 다운로드는 목록 조회처럼 가능하다. */
  @Test
  void open_project_non_member_non_reporter_cannot_upload_but_can_download() {
    Long owner = createUser("owner");
    Long stranger = createUser("stranger");
    ProjectResponse p = newOpenProject(owner, "OB");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    Long fileId =
        service
            .upload(owner, p.key(), 1, List.of(mockFile("a.txt", new byte[] {1})))
            .get(0)
            .fileId();

    assertThatThrownBy(
            () -> service.upload(stranger, p.key(), 1, List.of(mockFile("b.txt", new byte[] {2}))))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThat(service.download(stranger, p.key(), 1, fileId).originalName()).isEqualTo("a.txt");
    // 첨부자도 OWNER 도 아니므로 삭제는 거부.
    assertThatThrownBy(() -> service.delete(stranger, p.key(), 1, fileId))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** WP-202: TEAM 프로젝트 비멤버는 reporter 여도 첨부·다운로드 모두 거부(OPEN 예외가 TEAM 으로 새지 않게). */
  @Test
  void team_project_non_member_reporter_cannot_upload_or_download() {
    Long owner = createUser("owner");
    Long reporter = createUser("reporter");
    ProjectResponse p = newProject(owner, "TA");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, reporter);
    Long fileId =
        service
            .upload(owner, p.key(), 1, List.of(mockFile("a.txt", new byte[] {1})))
            .get(0)
            .fileId();

    assertThatThrownBy(
            () -> service.upload(reporter, p.key(), 1, List.of(mockFile("b.txt", new byte[] {2}))))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> service.download(reporter, p.key(), 1, fileId))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }
}
