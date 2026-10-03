package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.AttachmentNotFoundException;
import com.workplace.issue.exception.IssueBodyImageLimitException;
import com.workplace.issue.exception.IssueBodyImageRejectedException;
import com.workplace.issue.repository.IssueBodyImageRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
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
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

/** IssueBodyImageService 업로드 통합 테스트(WP-199) — 매직바이트 판정·생성 권한·크기·임시 업로드 상한. */
@Transactional
class IssueBodyImageServiceTest extends IntegrationTestBase {

  /** 테스트 테넌트 ID — connection-init-sql 의 app.tenant_id=1 과 일치. */
  private static final long TEST_TENANT_ID = 1L;

  @Autowired DSLContext dsl;
  @Autowired IssueBodyImageService service;
  @Autowired IssueBodyImageRepository repo;
  @Autowired ProjectService projectService;
  @Autowired IssueAttachmentService attachmentService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueService issueService;

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
    // 상한 테스트가 바꾼 싱글턴 빈 값을 원복 — 다른 테스트로 누수 방지.
    ReflectionTestUtils.setField(service, "maxPendingPerUser", 50);
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

  private ProjectResponse newOpenProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x", "OPEN"));
  }

  /** 1x1 PNG 의 앞부분 — 매직바이트 판정만 통과하면 된다. */
  private static final byte[] PNG =
      new byte[] {
        (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 'I', 'H', 'D', 'R'
      };

  private MockMultipartFile image(String name, byte[] body) {
    return new MockMultipartFile("file", name, "image/png", body);
  }

  @Test
  void member_uploads_png_as_pending_temp_file() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "BI");

    var res = service.upload(owner, p.key(), image("shot.png", PNG));

    assertThat(res.url())
        .isEqualTo("/api/v1/projects/" + p.key() + "/issue-images/" + res.fileId());
    assertThat(res.mimeType()).isEqualTo("image/png");
    var meta = repo.findMeta(res.fileId()).orElseThrow();
    assertThat(meta.issueId()).isNull();
    assertThat(meta.uploadedBy()).isEqualTo(owner);
    // 임시 파일 — 만료가 걸려 있어야 버려진 업로드가 수거된다.
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(res.fileId()))
                .fetchOne(FILE.EXPIRES_AT))
        .isNotNull();
  }

  @Test
  void open_project_non_member_can_upload() {
    Long owner = createUser("owner");
    Long outsider = createUser("voc");
    ProjectResponse p = newOpenProject(owner, "BO");

    assertThat(service.upload(outsider, p.key(), image("bug.png", PNG)).fileId()).isPositive();
  }

  @Test
  void team_project_non_member_is_denied() {
    Long owner = createUser("owner");
    Long outsider = createUser("out");
    ProjectResponse p = newProject(owner, "BT");

    assertThatThrownBy(() -> service.upload(outsider, p.key(), image("a.png", PNG)))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void html_disguised_as_png_and_svg_are_rejected() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "BR");
    byte[] html = "<html><script>alert(1)</script></html>".getBytes();
    byte[] svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>".getBytes();

    assertThatThrownBy(() -> service.upload(owner, p.key(), image("x.png", html)))
        .isInstanceOf(IssueBodyImageRejectedException.class);
    assertThatThrownBy(
            () ->
                service.upload(
                    owner, p.key(), new MockMultipartFile("file", "x.svg", "image/svg+xml", svg)))
        .isInstanceOf(IssueBodyImageRejectedException.class);
  }

  @Test
  void too_large_is_rejected() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "BL");
    byte[] big = new byte[10 * 1024 * 1024 + 1];
    System.arraycopy(PNG, 0, big, 0, PNG.length);

    assertThatThrownBy(() -> service.upload(owner, p.key(), image("big.png", big)))
        .isInstanceOf(IssueBodyImageRejectedException.class);
  }

  @Test
  void pending_upload_cap_per_user_and_project() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "BC");
    ReflectionTestUtils.setField(service, "maxPendingPerUser", 2);
    service.upload(owner, p.key(), image("1.png", PNG));
    service.upload(owner, p.key(), image("2.png", PNG));

    assertThatThrownBy(() -> service.upload(owner, p.key(), image("3.png", PNG)))
        .isInstanceOf(IssueBodyImageLimitException.class);
  }

  /** 저장 전 임시 이미지는 업로더 본인만 볼 수 있다 — id 추측으로 남의 작성 중 이미지를 보지 못하게. */
  @Test
  void pending_image_visible_only_to_uploader() {
    Long owner = createUser("owner");
    Long other = createUser("other");
    ProjectResponse p = newOpenProject(owner, "GV");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();

    assertThat(service.load(owner, p.key(), fileId).mimeType()).isEqualTo("image/png");
    assertThatThrownBy(() -> service.load(other, p.key(), fileId))
        .isInstanceOf(AttachmentNotFoundException.class);
  }

  /** IDOR — 업로더 본인이어도 다른 프로젝트 키로는 열 수 없다(키는 권한 판정, 파일 소속은 매핑으로 따로 검증). */
  @Test
  void other_project_key_cannot_open_file_idor() {
    Long owner = createUser("owner");
    ProjectResponse a = newProject(owner, "GA");
    ProjectResponse b = newOpenProject(owner, "GB");
    long fileId = service.upload(owner, a.key(), image("a.png", PNG)).fileId();

    assertThatThrownBy(() -> service.load(owner, b.key(), fileId))
        .isInstanceOf(AttachmentNotFoundException.class);
  }

  /** 일반 이슈 첨부(issue_body_image 매핑 없음) id 로는 본문 이미지 API 로 열 수 없다. */
  @Test
  void non_image_file_id_is_not_served() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "GN");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    Long attachmentFileId =
        attachmentService
            .upload(
                owner,
                p.key(),
                1,
                List.of(new MockMultipartFile("files", "x.png", "image/png", PNG)))
            .get(0)
            .fileId();

    assertThatThrownBy(() -> service.load(owner, p.key(), attachmentFileId))
        .isInstanceOf(AttachmentNotFoundException.class);
  }

  // ---- WP-199 Task 5: 저장 시 연결·강등 ----

  /** CreateIssueRequest 헬퍼 — 제목·본문 외에는 기본값. */
  private CreateIssueRequest createReq(String title, String body) {
    return new CreateIssueRequest(title, body, null, null, null, null, null, null);
  }

  /** 본문만 바꾸는 PATCH (version null → 충돌 검사 생략). */
  private UpdateIssueRequest bodyOnly(String body) {
    return new UpdateIssueRequest(null, body, null, null, null, null, null, null, null, null, null);
  }

  /** 제목만 바꾸는 PATCH — 본문 null 이면 이미지 동기화를 건드리지 않아야 한다. */
  private UpdateIssueRequest titleOnly(String title) {
    return new UpdateIssueRequest(
        title, null, null, null, null, null, null, null, null, null, null);
  }

  private String ref(String key, long fileId) {
    return "![shot](/api/v1/projects/" + key + "/issue-images/" + fileId + ")";
  }

  private OffsetDateTime expiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  @Test
  void create_claims_own_pending_image_and_makes_it_permanent() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "SC");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();

    var created =
        issueService.create(owner, p.key(), createReq("버그", "재현:\n" + ref(p.key(), fileId)));

    var meta = repo.findMeta(fileId).orElseThrow();
    assertThat(meta.issueId()).isEqualTo(created.id());
    assertThat(expiresAt(fileId)).isNull();
  }

  @Test
  void open_non_member_reporter_claims_on_create_and_others_can_view() {
    Long owner = createUser("owner");
    Long voc = createUser("voc");
    Long viewer = createUser("viewer");
    ProjectResponse p = newOpenProject(owner, "SO");
    long fileId = service.upload(voc, p.key(), image("a.png", PNG)).fileId();

    issueService.create(voc, p.key(), createReq("VOC", ref(p.key(), fileId)));

    // 연결 후에는 OPEN 프로젝트를 볼 수 있는 누구나 조회 가능.
    assertThat(service.load(viewer, p.key(), fileId).mimeType()).isEqualTo("image/png");
  }

  @Test
  void foreign_ids_are_ignored_and_save_succeeds() {
    Long owner = createUser("owner");
    Long other = createUser("other");
    ProjectResponse p = newProject(owner, "SF");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    ProjectResponse q = newProject(owner, "SG");
    long othersPending = service.upload(other, p.key(), image("o.png", PNG)).fileId();
    long otherProject = service.upload(owner, q.key(), image("q.png", PNG)).fileId();

    var created =
        issueService.create(
            owner,
            p.key(),
            createReq(
                "t",
                ref(p.key(), othersPending)
                    + ref(p.key(), otherProject)
                    + ref(p.key(), 999999999L)));

    // 남의 임시 파일·다른 프로젝트 파일·없는 id 는 연결되지 않고, 저장은 성공한다.
    assertThat(repo.findMeta(othersPending).orElseThrow().issueId()).isNull();
    assertThat(repo.findMeta(otherProject).orElseThrow().issueId()).isNull();
    assertThat(created.id()).isPositive();
  }

  @Test
  void overflow_20_digit_id_is_ignored_and_save_succeeds() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "SO");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();

    // 20자리 id 는 앞 19자리로 잘려 다른 id 로 읽히면 안 된다. 정상 id 참조는 그대로 연결.
    var created =
        issueService.create(
            owner,
            p.key(),
            createReq(
                "t",
                ref(p.key(), fileId)
                    + "![x](/api/v1/projects/"
                    + p.key()
                    + "/issue-images/"
                    + fileId
                    + "0000000000000000000)"));

    assertThat(created.id()).isPositive();
    assertThat(repo.findMeta(fileId).orElseThrow().issueId()).isNotNull();
  }

  @Test
  void image_bound_to_issue_a_stays_when_referenced_by_issue_b() {
    Long owner = createUser("owner");
    Long other = createUser("other");
    ProjectResponse p = newProject(owner, "SM");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();
    var a = issueService.create(owner, p.key(), createReq("A", ref(p.key(), fileId)));

    // 다른 멤버가 B 본문에 같은 이미지를 붙여넣어도 소유 이슈(A)는 그대로다.
    issueService.create(other, p.key(), createReq("B", "복사 " + ref(p.key(), fileId)));

    assertThat(repo.findMeta(fileId).orElseThrow().issueId()).isEqualTo(a.id());
  }

  @Test
  void removing_from_body_demotes_and_reinserting_restores() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "SD");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();
    var created = issueService.create(owner, p.key(), createReq("t", ref(p.key(), fileId)));

    issueService.update(owner, p.key(), created.number(), bodyOnly("이미지 지움"));
    assertThat(expiresAt(fileId)).isAfter(OffsetDateTime.now().plusDays(6));

    issueService.update(owner, p.key(), created.number(), bodyOnly(ref(p.key(), fileId)));
    assertThat(expiresAt(fileId)).isNull();
  }

  @Test
  void update_without_body_does_not_touch_images() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "SN");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();
    var created = issueService.create(owner, p.key(), createReq("t", ref(p.key(), fileId)));

    issueService.update(owner, p.key(), created.number(), titleOnly("새 제목"));

    assertThat(expiresAt(fileId)).isNull();
  }

  @Test
  void soft_deleting_issue_demotes_its_images() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "SX");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();
    var created = issueService.create(owner, p.key(), createReq("t", ref(p.key(), fileId)));
    assertThat(expiresAt(fileId)).isNull();

    issueService.softDelete(owner, p.key(), created.number());

    // 삭제 후엔 syncWithBody 가 불리지 않으므로 삭제 시점에 강등돼 유예 후 수거 대상이 된다.
    assertThat(expiresAt(fileId))
        .isAfter(OffsetDateTime.now().plusDays(6))
        .isBefore(OffsetDateTime.now().plusDays(8));
  }

  @Test
  void image_of_deleted_origin_is_still_served_to_member() {
    Long owner = createUser("owner");
    Long other = createUser("other");
    ProjectResponse p = newProject(owner, "SY");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();
    var a = issueService.create(owner, p.key(), createReq("A", ref(p.key(), fileId)));
    issueService.create(owner, p.key(), createReq("B", "복사 " + ref(p.key(), fileId)));

    issueService.softDelete(owner, p.key(), a.number());

    // 원본 A 가 삭제돼도 B 에 복사된 이미지는 계속 보여야 한다.
    assertThat(service.load(other, p.key(), fileId)).isNotNull();
  }
}
