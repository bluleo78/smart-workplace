package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueSearchService 의 attachmentCount 통합 — N+1 회피 + 정확한 값. */
@Transactional
class IssueSearchServiceAttachmentCountTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueAttachmentRepository attachmentRepository;
  @Autowired ProjectService projectService;

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
  void search_result_includes_attachment_count() {
    Long owner = createUser("o");
    ProjectResponse p =
        projectService.create(owner, new CreateProjectRequest(uniqueKey("AC"), "P", "x"));
    IssueRow i1 = issueRepository.insert(p.id(), 1, "t1", null, "MID", null, owner);
    IssueRow i2 = issueRepository.insert(p.id(), 2, "t2", null, "MID", null, owner);

    // i1 에 첨부 3개
    for (int i = 0; i < 3; i++) {
      attachmentRepository.insert(insertFileRow(owner, "f" + i + ".txt"), i1.id(), owner);
    }
    // i2 는 첨부 0개

    var resp = searchService.search(owner, p.key(), Map.of());

    IssueResponse r1 = resp.items().stream().filter(x -> x.number() == 1).findFirst().orElseThrow();
    IssueResponse r2 = resp.items().stream().filter(x -> x.number() == 2).findFirst().orElseThrow();

    assertThat(r1.attachmentCount()).isEqualTo(3);
    assertThat(r2.attachmentCount()).isZero();
  }
}
