package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** #520 이슈 source 백레퍼런스 저장·조회 — 테넌트 RLS 내 동작. */
class IssueSourceRepositoryTest extends IntegrationTestBase {

  @Autowired private IssueRepository issueRepository;
  @Autowired private ProjectService projectService;
  @Autowired private DSLContext dsl;

  @Test
  void updateSource_thenFindBySource_returnsIssueKey() {
    // given: tenant#1 컨텍스트에서 사용자 + 프로젝트 + 이슈 생성
    long userId = createUser("src");
    TenantContext.set(1L);
    long projectId =
        projectService
            .create(userId, new CreateProjectRequest(uniqueKey("SRC"), "Source 테스트", "x"))
            .id();
    long issueId =
        issueRepository.insert(projectId, 1, "출처 테스트 이슈", null, "MID", null, userId).id();
    long mailMessageId = 7777L;

    try {
      // when
      issueRepository.updateSource(issueId, "MAIL", mailMessageId);

      // then
      assertThat(issueRepository.findSourceIssueKey("MAIL", mailMessageId)).isPresent();
    } finally {
      // 공유 test DB 누수 방지 — RLS-안전 정리
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(com.workplace.jooq.Tables.ISSUE)
                .where(com.workplace.jooq.Tables.ISSUE.ID.eq(issueId))
                .execute();
          });
      TenantContext.clear();
    }
  }

  @Test
  void findSourceIssueKey_noMatch_returnsEmpty() {
    assertThat(issueRepository.findSourceIssueKey("MAIL", 999999L)).isEmpty();
  }

  /** 테스트용 USER 직접 삽입. */
  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    return id;
  }

  /** 프로젝트 key 충돌 방지용 고유 키 생성. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }
}
