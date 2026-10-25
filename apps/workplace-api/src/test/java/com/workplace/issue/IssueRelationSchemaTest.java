package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.domain.IssueRelationBuiltIns;
import com.workplace.issue.domain.IssueRelationBuiltIns.BuiltIn;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.Record;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-887 V214 — 이슈 관계 유형·관계·외부 링크 스키마, 기본 유형 시드, 관리 권한, 테넌트 격리 검증.
 *
 * <p>jOOQ 코드젠 없이도 컴파일되도록 표·컬럼을 SQL 문자열로 다룬다(코드젠 전 RED 확인용).
 */
@Transactional
class IssueRelationSchemaTest extends IntegrationTestBase {

  @Autowired private ProjectService projectService;
  @Autowired private IssueRepository issueRepository;

  /** tenant#1 의 기본 유형(code 있는 행)이 IssueRelationBuiltIns.ALL 과 같은 값으로 시드돼 있다. */
  @Test
  void builtInsSeededForExistingTenant() {
    List<Record> rows =
        baseDsl.fetch(
            "SELECT code, name, directed, outward_label, inward_label, external_only, hidden,"
                + " sort_order FROM issue_relation_type WHERE tenant_id = 1 AND code IS NOT NULL"
                + " ORDER BY sort_order");

    assertThat(rows).hasSize(6);
    for (int i = 0; i < rows.size(); i++) {
      BuiltIn expected = IssueRelationBuiltIns.ALL.get(i);
      Record r = rows.get(i);
      assertThat(r.get("code", String.class)).isEqualTo(expected.code());
      assertThat(r.get("name", String.class)).isEqualTo(expected.name());
      assertThat(r.get("directed", Boolean.class)).isEqualTo(expected.directed());
      assertThat(r.get("outward_label", String.class)).isEqualTo(expected.outwardLabel());
      assertThat(r.get("inward_label", String.class)).isEqualTo(expected.inwardLabel());
      assertThat(r.get("external_only", Boolean.class)).isEqualTo(expected.externalOnly());
      assertThat(r.get("hidden", Boolean.class)).isFalse();
      assertThat(r.get("sort_order", Integer.class)).isEqualTo(expected.sortOrder());
    }
  }

  /** ADMIN 시스템 역할만 issue_relation_type:manage 를 가진다 — USER·AGENT 에는 없다. */
  @Test
  void adminRoleHasManagePermission() {
    assertThat(roleHasManage("ADMIN")).isTrue();
    assertThat(roleHasManage("USER")).isFalse();
    assertThat(roleHasManage("AGENT")).isFalse();
  }

  private boolean roleHasManage(String roleName) {
    return !baseDsl
        .fetch(
            "SELECT 1 FROM role r JOIN role_permission rp ON rp.role_id = r.id"
                + " JOIN permission p ON p.id = rp.permission_id"
                + " WHERE r.tenant_id = 1 AND r.name = ? AND r.is_system"
                + " AND p.code = 'issue_relation_type:manage'",
            roleName)
        .isEmpty();
  }

  /** 자기 자신과의 관계는 CHECK 로 거부된다. */
  @Test
  void relationRejectsSelfLink() {
    long issueId = seedIssues(1)[0];
    long typeId = relatesTypeId();

    assertThatThrownBy(
            () ->
                baseDsl.execute(
                    "INSERT INTO issue_relation (type_id, source_issue_id, target_issue_id)"
                        + " VALUES (?, ?, ?)",
                    typeId,
                    issueId,
                    issueId))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 다른 테넌트 GUC 에서는 tenant#1 의 유형·관계·외부 링크가 모두 0행으로 보인다(RLS). */
  @Test
  void rlsIsolatesTenants() {
    // tenant#1 에 관계·외부 링크를 한 줄씩 만들어 둔다 — 비어 있는 표의 0행은 격리를 증명하지 못한다.
    long[] issues = seedIssues(2);
    long typeId = relatesTypeId();
    baseDsl.execute(
        "INSERT INTO issue_relation (type_id, source_issue_id, target_issue_id) VALUES (?, ?, ?)",
        typeId,
        issues[0],
        issues[1]);
    baseDsl.execute(
        "INSERT INTO issue_external_link (issue_id, type_id, issue_is_source, url, title)"
            + " VALUES (?, ?, true, 'https://example.com/browse/X-1', 'X-1')",
        issues[0],
        typeId);
    long tid2 =
        baseDsl
            .fetchOne(
                "INSERT INTO tenant (slug, name, status) VALUES (?, 'RLS-REL', 'ACTIVE') RETURNING id",
                "rls-rel-" + System.nanoTime())
            .get("id", Long.class);
    useTenant(tid2);

    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_relation_type"))).isZero();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_relation"))).isZero();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_external_link"))).isZero();

    useTenant(1L);
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_relation_type")))
        .isGreaterThanOrEqualTo(6);
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_relation"))).isPositive();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_external_link"))).isPositive();
  }

  /** tenant#1 에 사용자·프로젝트를 새로 만들고 이슈 n 개를 시드해 id 를 돌려준다. */
  private long[] seedIssues(int n) {
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 4).toUpperCase();
    long userId =
        baseDsl
            .fetchOne(
                "INSERT INTO \"user\" (username, password, name, email) VALUES (?, 'pw', 'rel', ?)"
                    + " RETURNING id",
                "rel-" + suffix,
                "rel-" + suffix + "@example.com")
            .get("id", Long.class);
    long projectId =
        projectService.create(userId, new CreateProjectRequest("RL" + suffix, "Rel", "x")).id();
    long[] ids = new long[n];
    for (int i = 0; i < n; i++) {
      ids[i] =
          IssueSeeds.insert(
                  issueRepository, baseDsl, projectId, i + 1, "관계 " + i, null, "MID", null, userId)
              .id();
    }
    return ids;
  }

  /** tenant#1 의 기본 「관련」 유형 id. */
  private long relatesTypeId() {
    return baseDsl
        .fetchOne("SELECT id FROM issue_relation_type WHERE tenant_id = 1 AND code = 'RELATES'")
        .get("id", Long.class);
  }
}
