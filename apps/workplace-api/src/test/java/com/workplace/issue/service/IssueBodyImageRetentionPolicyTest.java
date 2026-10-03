package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** IssueBodyImageRetentionPolicy 통합 테스트(WP-199) — 만료 스윕 직전 다른 이슈 본문 참조 보존. */
@Transactional
class IssueBodyImageRetentionPolicyTest extends IntegrationTestBase {

  /** 테스트 테넌트 ID — connection-init-sql 의 app.tenant_id=1 과 일치. */
  private static final long TEST_TENANT_ID = 1L;

  @Autowired DSLContext dsl;
  @Autowired IssueBodyImageService service;
  @Autowired IssueBodyImageRetentionPolicy policy;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;

  /** FilePathBuilder 가 TenantContext 를 쓰므로 테스트 시작 전 테넌트를 설정한다. */
  @BeforeEach
  void setUpTenantContext() {
    TenantContext.set(TEST_TENANT_ID);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  /** USER + USER_ROLE + 테넌트 멤버십 직접 INSERT. */
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

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  /** 1x1 PNG 의 앞부분 — 매직바이트 판정만 통과하면 된다. */
  private static final byte[] PNG =
      new byte[] {
        (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 'I', 'H', 'D', 'R'
      };

  private MockMultipartFile image(String name, byte[] body) {
    return new MockMultipartFile("file", name, "image/png", body);
  }

  private CreateIssueRequest createReq(String title, String body) {
    return new CreateIssueRequest(title, body, null, null, null, null, null, null);
  }

  /** 본문만 바꾸는 PATCH (version null → 충돌 검사 생략). */
  private UpdateIssueRequest bodyOnly(String body) {
    return new UpdateIssueRequest(null, body, null, null, null, null, null, null, null, null, null);
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
  void image_still_referenced_by_copied_issue_is_retained_and_rearmed() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "RT");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();
    var a = issueService.create(owner, p.key(), createReq("원본", ref(p.key(), fileId)));
    issueService.create(owner, p.key(), createReq("사본", "복사함 " + ref(p.key(), fileId)));
    issueService.update(owner, p.key(), a.number(), bodyOnly("원본에서 지움"));

    Set<Long> kept = policy.retain(List.of(fileId));

    assertThat(kept).containsExactly(fileId);
    assertThat(expiresAt(fileId)).isAfter(OffsetDateTime.now().plusDays(6));
  }

  @Test
  void unreferenced_image_is_not_retained() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "RU");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();

    assertThat(policy.retain(List.of(fileId))).isEmpty();
  }

  @Test
  void prefix_id_does_not_count_as_reference() {
    Long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "RP");
    long fileId = service.upload(owner, p.key(), image("a.png", PNG)).fileId();
    // fileId 뒤에 숫자가 더 붙은 다른 id 참조만 있는 본문 — 접두 일치로 보존되면 안 된다.
    issueService.create(
        owner,
        p.key(),
        createReq("t", "/api/v1/projects/" + p.key() + "/issue-images/" + fileId + "7"));

    assertThat(policy.retain(List.of(fileId))).isEmpty();
  }

  @Test
  void non_issue_files_are_ignored() {
    assertThat(policy.retain(List.of(Long.MAX_VALUE))).isEmpty();
  }
}
