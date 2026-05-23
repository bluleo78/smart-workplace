package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** IssueAttachmentService 통합 테스트 — 멤버/사이즈/한도/권한 게이트 + history 기록. */
@Transactional
class IssueAttachmentServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueAttachmentService service;
  @Autowired IssueAttachmentRepository repo;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired ProjectService projectService;

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
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);

    var result =
        service.upload(owner, p.key(), 1, List.of(mockFile("a.txt", new byte[] {1, 2, 3})));

    assertThat(result).hasSize(1);
    assertThat(result.get(0).originalName()).isEqualTo("a.txt");
    assertThat(historyRepository.findByIssue(issue.id()))
        .anyMatch(h -> "ATTACHMENTS_CHANGED".equals(h.eventType()));
  }

  @Test
  void file_exceeds_25mb_throws_400() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "AT");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);

    byte[] huge = new byte[26 * 1024 * 1024]; // 26MB
    assertThatThrownBy(() -> service.upload(owner, p.key(), 1, List.of(mockFile("big.bin", huge))))
        .isInstanceOf(AttachmentTooLargeException.class);
  }

  @Test
  void over_10_per_issue_throws_409() throws IOException {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "AT");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);

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
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);

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
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);

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
}
