package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueRow;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueAttachmentRepository 통합 테스트 — insert / find / count 동작 검증. */
@Transactional
class IssueAttachmentRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueAttachmentRepository repo;
  @Autowired IssueRepository issueRepository;
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

  /** file 테이블에 더미 row 삽입 (디스크 쓰기 없음) — repo 테스트용 헬퍼. */
  private Long insertFileRow(Long userId, String name) {
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, name)
        .set(FILE.STORED_NAME, "stored-" + name)
        .set(FILE.MIME_TYPE, "application/octet-stream")
        .set(FILE.SIZE_BYTES, 100L)
        .set(FILE.STORAGE_PATH, "/tmp/" + name)
        .set(FILE.UPLOADED_BY, userId)
        .set(FILE.CREATED_AT, OffsetDateTime.now())
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void insert_and_find_by_issue() {
    Long owner = createUser("a");
    ProjectResponse p = newProject(owner, "AT");
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);
    Long fileId = insertFileRow(owner, "a.txt");

    repo.insert(fileId, issue.id(), owner);

    var found = repo.findByIssue(issue.id());
    assertThat(found).hasSize(1);
    assertThat(found.get(0).fileId()).isEqualTo(fileId);
    assertThat(found.get(0).originalName()).isEqualTo("a.txt");
    assertThat(found.get(0).issueId()).isEqualTo(issue.id());
  }

  @Test
  void count_by_issue_ids_returns_zero_for_missing() {
    Long owner = createUser("b");
    ProjectResponse p = newProject(owner, "AT");
    IssueRow issue1 = issueRepository.insert(p.id(), 1, "t1", null, "MID", null, owner, null);
    IssueRow issue2 = issueRepository.insert(p.id(), 2, "t2", null, "MID", null, owner, null);
    // issue1 에 첨부 2개
    repo.insert(insertFileRow(owner, "x.txt"), issue1.id(), owner);
    repo.insert(insertFileRow(owner, "y.txt"), issue1.id(), owner);
    // issue2 는 첨부 없음

    var map = repo.countByIssueIds(List.of(issue1.id(), issue2.id()));

    assertThat(map.get(issue1.id())).isEqualTo(2);
    assertThat(map.get(issue2.id())).isEqualTo(0);
  }

  @Test
  void find_by_id_returns_user_name() {
    Long owner = createUser("attacher-name");
    ProjectResponse p = newProject(owner, "AT");
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);
    Long fileId = insertFileRow(owner, "doc.pdf");
    repo.insert(fileId, issue.id(), owner);

    var opt = repo.findById(fileId);

    assertThat(opt).isPresent();
    assertThat(opt.get().attachedByName()).isEqualTo("attacher-name");
    assertThat(opt.get().originalName()).isEqualTo("doc.pdf");
  }

  @Test
  void count_by_issue_ids_with_empty_list_returns_empty_map() {
    assertThat(repo.countByIssueIds(List.of())).isEmpty();
  }
}
