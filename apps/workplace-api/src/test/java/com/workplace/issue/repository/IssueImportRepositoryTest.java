package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.util.PSQLException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-883: 이슈 가져오기용 저장소 메서드 — 원본 시각·가져옴 표시·원본 키를 INSERT 한 번에 쓰고, 번호 시퀀스를 올리고, 삭제된 번호까지 중복 검사한다. 중복은
 * 서비스가 제약 이름으로 원본 키·번호 409 를 가르므로 그 이름까지 고정한다.
 */
@Transactional
class IssueImportRepositoryTest extends IntegrationTestBase {

  @Autowired private IssueRepository issueRepository;
  @Autowired private IssueCommentRepository commentRepository;
  @Autowired private IssueAttachmentRepository attachmentRepository;
  @Autowired private IssueHistoryRepository historyRepository;
  @Autowired private ProjectIssueSequenceRepository sequenceRepository;
  @Autowired private ProjectService projectService;
  @Autowired private ProjectStatusRepository statusRepository;
  @Autowired private IssueTypeRepository typeRepository;

  private long userId;
  private long projectId;

  private static final OffsetDateTime T1 = OffsetDateTime.parse("2026-06-11T10:00:00+09:00");
  private static final OffsetDateTime T2 = OffsetDateTime.parse("2026-06-12T10:00:00+09:00");

  @BeforeEach
  void setUp() {
    userId = newUser();
    projectId = newProject();
  }

  private long newUser() {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return baseDsl
        .insertInto(USER)
        .set(USER.USERNAME, "im-" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "im")
        .set(USER.EMAIL, "im-" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long newProject() {
    String s = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(userId, new CreateProjectRequest("IM" + s, "Import", "x")).id();
  }

  private long newIssue(long project, int number) {
    return IssueSeeds.insert(
            issueRepository, baseDsl, project, number, "t" + number, null, "MID", null, userId)
        .id();
  }

  /** 가져오기 표시를 실은 INSERT — 할 일 상태·TASK 유형, 생성 T1·수정 T2, 종료 없음. */
  private long importedIssue(long project, int number, String sourceKey) {
    var todo = statusRepository.findDefault(project, "TODO").orElseThrow();
    return issueRepository
        .insert(
            project,
            number,
            "t" + number,
            null,
            "MID",
            null,
            userId,
            typeRepository.findByProjectAndName(project, "TASK").orElseThrow().id(),
            null,
            null,
            null,
            "TODO",
            todo.id(),
            todo.name(),
            todo.color(),
            null,
            new IssueRepository.ImportMarks(T1, T2, null, userId, sourceKey))
        .id();
  }

  /** 고유 제약 위반의 제약 이름 — 서비스(IssueImportService.insertIssue)가 이 값으로 원본 키·번호 중복을 가른다. */
  private static String constraintOf(Throwable e) {
    var cause = ((DuplicateKeyException) e).getMostSpecificCause();
    return ((PSQLException) cause).getServerErrorMessage().getConstraint();
  }

  @Test
  void insertWithImportMarks_writesTimesAndMarker() {
    long id = importedIssue(projectId, 1, "CLIM-17");

    var r = baseDsl.selectFrom(ISSUE).where(ISSUE.ID.eq(id)).fetchOne();
    assertThat(r.getCreatedAt().toInstant()).isEqualTo(T1.toInstant());
    assertThat(r.getUpdatedAt().toInstant()).isEqualTo(T2.toInstant());
    assertThat(r.getClosedAt()).isNull();
    assertThat(r.getImportSourceKey()).isEqualTo("CLIM-17");
    assertThat(r.getImportedBy()).isEqualTo(userId);
    assertThat(r.getImportedAt()).isNotNull();
  }

  @Test
  void raiseTo_neverLowers() {
    assertThat(sequenceRepository.allocateNext(projectId)).isEqualTo(1);
    assertThat(sequenceRepository.allocateNext(projectId)).isEqualTo(2);
    sequenceRepository.raiseTo(projectId, 18);
    assertThat(sequenceRepository.allocateNext(projectId)).isEqualTo(18);
    sequenceRepository.raiseTo(projectId, 5);
    assertThat(sequenceRepository.allocateNext(projectId)).isEqualTo(19);
  }

  @Test
  void existsNumberIncludingDeleted_seesSoftDeleted() {
    long id = newIssue(projectId, 3);
    assertThat(issueRepository.existsNumberIncludingDeleted(projectId, 3)).isTrue();
    baseDsl
        .update(ISSUE)
        .set(ISSUE.DELETED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(id))
        .execute();
    assertThat(issueRepository.existsNumberIncludingDeleted(projectId, 3)).isTrue();
    assertThat(issueRepository.existsNumberIncludingDeleted(projectId, 4)).isFalse();
  }

  @Test
  void sourceKeyUnique_perProject() {
    importedIssue(projectId, 1, "K-1");
    assertThat(issueRepository.existsImportSourceKey(projectId, "K-1")).isTrue();
    assertThat(issueRepository.existsImportSourceKey(projectId, "K-2")).isFalse();

    // 서비스가 이 예외 종류·제약 이름으로 경합을 원본 키 409 로 바꾸므로(IssueImportService.insertIssue) 정확히 이것이어야 한다.
    assertThatThrownBy(() -> importedIssue(projectId, 2, "K-1"))
        .isInstanceOf(DuplicateKeyException.class)
        .satisfies(
            e -> assertThat(constraintOf(e)).isEqualTo("uq_issue_project_import_source_key"));
  }

  @Test
  void numberUnique_reportsNumberConstraint() {
    importedIssue(projectId, 1, "K-1");

    // 원본 키가 달라도 같은 번호면 번호 제약 — 서비스는 이것을 번호 409 로 바꾼다.
    assertThatThrownBy(() -> importedIssue(projectId, 1, "K-2"))
        .isInstanceOf(DuplicateKeyException.class)
        .satisfies(e -> assertThat(constraintOf(e)).isEqualTo("uq_issue_project_number"));
  }

  @Test
  void sourceKey_allowedInOtherProject() {
    long other = newProject();
    importedIssue(projectId, 1, "K-1");
    importedIssue(other, 1, "K-1");
    assertThat(issueRepository.existsImportSourceKey(other, "K-1")).isTrue();
  }

  @Test
  void historyInsert_withCreatedAt() {
    long id = newIssue(projectId, 1);
    historyRepository.insert(id, userId, "STATUS", "TODO", "DONE", T1);
    var at =
        baseDsl
            .select(ISSUE_HISTORY.CREATED_AT)
            .from(ISSUE_HISTORY)
            .where(ISSUE_HISTORY.ISSUE_ID.eq(id))
            .fetchOne(ISSUE_HISTORY.CREATED_AT);
    assertThat(at.toInstant()).isEqualTo(T1.toInstant());
  }

  @Test
  void attachmentInsert_withAttachedAt() {
    long id = newIssue(projectId, 1);
    long fileId =
        baseDsl
            .insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "a.txt")
            .set(FILE.STORED_NAME, "stored-" + UUID.randomUUID())
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 1L)
            .set(FILE.STORAGE_PATH, "/tmp/a.txt")
            .set(FILE.UPLOADED_BY, userId)
            .set(FILE.CREATED_AT, OffsetDateTime.now())
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    attachmentRepository.insert(fileId, id, userId, T2);
    var at =
        baseDsl
            .select(ISSUE_ATTACHMENT.ATTACHED_AT)
            .from(ISSUE_ATTACHMENT)
            .where(ISSUE_ATTACHMENT.FILE_ID.eq(fileId))
            .fetchOne(ISSUE_ATTACHMENT.ATTACHED_AT);
    assertThat(at.toInstant()).isEqualTo(T2.toInstant());
  }

  @Test
  void commentInsertImported() {
    long id = newIssue(projectId, 1);
    long commentId = commentRepository.insertImported(id, userId, "hi", T1, T2, userId);
    var r = baseDsl.selectFrom(ISSUE_COMMENT).where(ISSUE_COMMENT.ID.eq(commentId)).fetchOne();
    assertThat(r.getCreatedAt().toInstant()).isEqualTo(T1.toInstant());
    assertThat(r.getUpdatedAt().toInstant()).isEqualTo(T2.toInstant());
    assertThat(r.getImportedBy()).isEqualTo(userId);
    assertThat(r.getImportedAt()).isNotNull();
  }
}
