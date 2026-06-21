// IssueDriveLinkSourceResolverTest.java — ISSUE resolver + provider 통합 테스트
package com.workplace.drive;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueAttachmentSourceProvider;
import com.workplace.issue.service.IssueDriveLinkSourceResolver;
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

/**
 * IssueDriveLinkSourceResolver + IssueAttachmentSourceProvider 통합 테스트. 멤버=라벨/딥링크+accessible=true;
 * 비멤버=accessible=false(맵에는 존재); q 필터; beforeAt 커서.
 */
@Transactional
class IssueDriveLinkSourceResolverTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueDriveLinkSourceResolver issueResolver;
  @Autowired IssueAttachmentSourceProvider issueProvider;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;

  /** USER + USER_ROLE 직접 INSERT — 기존 IssueAttachmentServiceTest 패턴. */
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

  /** FILE 행 직접 삽입 — 디스크 I/O 없이 테스트 시드. STORED_NAME/STORAGE_PATH 은 더미값 사용. */
  private long seedFile(long uploaderId, String name, String mime) {
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, name)
        .set(FILE.STORED_NAME, UUID.randomUUID().toString())
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, 100L)
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, "/tmp/test/" + UUID.randomUUID())
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, OffsetDateTime.now())
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** ISSUE_ATTACHMENT 행 직접 삽입. */
  private void bindAttachment(long fileId, long issueId, long userId, OffsetDateTime at) {
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, fileId)
        .set(ISSUE_ATTACHMENT.ISSUE_ID, issueId)
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, userId)
        .set(ISSUE_ATTACHMENT.ATTACHED_AT, at)
        .execute();
  }

  // ── Resolver 테스트 ───────────────────────────────────────────────

  /** 멤버는 accessible=true + 올바른 라벨/딥링크; 비멤버는 accessible=false(맵에는 포함). */
  @Test
  void resolve_returnsLabelAndAccess_forMemberAndStranger() {
    Long owner = createUser("owner");
    Long stranger = createUser("stranger");
    ProjectResponse p = newProject(owner, "RS");
    IssueRow issue = issueRepository.insert(p.id(), 1, "리졸버 테스트 제목", null, "MID", null, owner);

    // 멤버(프로젝트 오너) → accessible=true
    var ownerMap = issueResolver.resolve(owner, List.of(issue.id()));
    assertThat(ownerMap).containsKey(issue.id());
    var ownerResolved = ownerMap.get(issue.id());
    assertThat(ownerResolved.accessible()).isTrue();
    assertThat(ownerResolved.label()).contains(p.key()).contains("1").contains("리졸버 테스트 제목");
    assertThat(ownerResolved.deepLink()).isEqualTo("/projects/" + p.key() + "/issues/1");

    // 비멤버 → 맵에 포함되지만 accessible=false
    var strangerMap = issueResolver.resolve(stranger, List.of(issue.id()));
    assertThat(strangerMap).containsKey(issue.id());
    assertThat(strangerMap.get(issue.id()).accessible()).isFalse();
  }

  /** 존재하지 않는 issueId 는 결과 맵에서 제외. */
  @Test
  void resolve_excludesNonExistentIssue() {
    Long owner = createUser("owner2");
    var map = issueResolver.resolve(owner, List.of(999_999_999L));
    assertThat(map).doesNotContainKey(999_999_999L);
  }

  // ── Provider 테스트 ───────────────────────────────────────────────

  /** 멤버 프로젝트의 첨부만 노출; 타 프로젝트 첨부는 비노출. */
  @Test
  void provider_list_showsMemberAttachmentsOnly() {
    Long owner = createUser("prov1");
    Long stranger = createUser("stranger2");

    ProjectResponse myProject = newProject(owner, "MP");
    ProjectResponse otherProject = newProject(stranger, "OP");

    IssueRow myIssue = issueRepository.insert(myProject.id(), 1, "내 이슈", null, "MID", null, owner);
    IssueRow otherIssue =
        issueRepository.insert(otherProject.id(), 1, "남의 이슈", null, "MID", null, stranger);

    long myFileId = seedFile(owner, "my-doc.pdf", "application/pdf");
    long otherFileId = seedFile(stranger, "other-doc.pdf", "application/pdf");

    OffsetDateTime now = OffsetDateTime.now();
    bindAttachment(myFileId, myIssue.id(), owner, now);
    bindAttachment(otherFileId, otherIssue.id(), stranger, now);

    List<com.workplace.drive.api.AttachmentSourceProvider.Entry> entries =
        issueProvider.list(owner, null, null, 10);

    // 내 프로젝트 첨부는 포함, 타 프로젝트는 제외
    assertThat(entries).anyMatch(e -> e.fileId() == myFileId);
    assertThat(entries).noneMatch(e -> e.fileId() == otherFileId);
  }

  /** q 필터: 파일명 부분일치 검색. */
  @Test
  void provider_list_filtersByName() {
    Long owner = createUser("qfilter");
    ProjectResponse p = newProject(owner, "QF");
    IssueRow issue = issueRepository.insert(p.id(), 1, "q이슈", null, "MID", null, owner);

    long fileA = seedFile(owner, "report_2024.pdf", "application/pdf");
    long fileB = seedFile(owner, "image_thumb.png", "image/png");

    OffsetDateTime now = OffsetDateTime.now();
    bindAttachment(fileA, issue.id(), owner, now.minusSeconds(2));
    bindAttachment(fileB, issue.id(), owner, now.minusSeconds(1));

    // "report" 으로 필터 → fileA 만
    var filtered = issueProvider.list(owner, "report", null, 10);
    assertThat(filtered).anyMatch(e -> e.fileId() == fileA);
    assertThat(filtered).noneMatch(e -> e.fileId() == fileB);
  }

  /** beforeAt 커서: 특정 시각 이전 첨부만 반환. */
  @Test
  void provider_list_cursorPagination() {
    Long owner = createUser("cursor");
    ProjectResponse p = newProject(owner, "CU");
    IssueRow issue = issueRepository.insert(p.id(), 1, "커서 이슈", null, "MID", null, owner);

    OffsetDateTime t1 = OffsetDateTime.now().minusSeconds(10);
    OffsetDateTime t2 = OffsetDateTime.now().minusSeconds(5);
    OffsetDateTime t3 = OffsetDateTime.now().minusSeconds(1);

    long f1 = seedFile(owner, "old.txt", "text/plain");
    long f2 = seedFile(owner, "mid.txt", "text/plain");
    long f3 = seedFile(owner, "new.txt", "text/plain");

    bindAttachment(f1, issue.id(), owner, t1);
    bindAttachment(f2, issue.id(), owner, t2);
    bindAttachment(f3, issue.id(), owner, t3);

    // t2 기준 커서 → f1 만 (t2 이전)
    var page = issueProvider.list(owner, null, t2.toInstant(), 10);
    assertThat(page).anyMatch(e -> e.fileId() == f1);
    assertThat(page).noneMatch(e -> e.fileId() == f2);
    assertThat(page).noneMatch(e -> e.fileId() == f3);
  }

  /** 결과는 attachedAt 내림차순 정렬. */
  @Test
  void provider_list_orderedByAttachedAtDesc() {
    Long owner = createUser("order");
    ProjectResponse p = newProject(owner, "OR");
    IssueRow issue = issueRepository.insert(p.id(), 1, "정렬 이슈", null, "MID", null, owner);

    OffsetDateTime older = OffsetDateTime.now().minusSeconds(10);
    OffsetDateTime newer = OffsetDateTime.now().minusSeconds(1);

    long fOld = seedFile(owner, "old.txt", "text/plain");
    long fNew = seedFile(owner, "new.txt", "text/plain");

    bindAttachment(fOld, issue.id(), owner, older);
    bindAttachment(fNew, issue.id(), owner, newer);

    var entries = issueProvider.list(owner, null, null, 10);
    // newer 가 먼저
    long firstId =
        entries.stream()
            .filter(e -> e.fileId() == fNew || e.fileId() == fOld)
            .findFirst()
            .map(e -> e.fileId())
            .orElse(-1L);
    assertThat(firstId).isEqualTo(fNew);
  }
}
