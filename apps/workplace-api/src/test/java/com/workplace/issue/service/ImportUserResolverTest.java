package com.workplace.issue.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 가져오기 원작성자 해석(WP-883): 프로젝트 멤버이고 이 워크스페이스에서 활성인 사람만 허용, 맞지 않은 이름은 전부 모아 거절. */
@Transactional
class ImportUserResolverTest extends IntegrationTestBase {

  @Autowired private ImportUserResolver resolver;
  @Autowired private ProjectService projectService;
  @Autowired private ProjectMemberRepository memberRepository;

  private long projectId;
  private long m1;
  private long m2;
  private long outsider;

  private String username(long id) {
    return baseDsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(id)).fetchOne(USER.USERNAME);
  }

  /** 테넌트 1 의 활성 멤버십과 프로젝트 멤버십을 가진 사용자. */
  private long member() {
    long id = TestFixtures.createHuman(baseDsl);
    TestFixtures.ensureActiveMember(baseDsl, id, 1L);
    memberRepository.insert(projectId, id, "MEMBER");
    return id;
  }

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 4).toUpperCase();
    long owner = TestFixtures.createHuman(baseDsl);
    TestFixtures.ensureActiveMember(baseDsl, owner, 1L);
    projectId =
        projectService.create(owner, new CreateProjectRequest("IR" + suffix, "Import", "x")).id();
    m1 = member();
    m2 = member();
    outsider = TestFixtures.createHuman(baseDsl);
    TestFixtures.ensureActiveMember(baseDsl, outsider, 1L);
  }

  @Test
  void allMembers_returnsSummaryMap() {
    var map = resolver.resolve(projectId, List.of(username(m1), username(m2)));
    assertThat(map).containsOnlyKeys(username(m1), username(m2));
    assertThat(map.get(username(m1)).id()).isEqualTo(m1);
  }

  @Test
  void nonMemberAndUnknown_reportedTogetherSorted() {
    assertThatThrownBy(
            () ->
                resolver.resolve(
                    projectId, List.of(username(m1), username(outsider), "ghost", username(m2))))
        .isInstanceOfSatisfying(
            IssueImportException.class,
            e -> {
              assertThat(e.errors().get("reason")).isEqualTo("IMPORT_UNKNOWN_USERS");
              String expected =
                  String.join(",", List.of(username(outsider), "ghost").stream().sorted().toList());
              assertThat(e.errors().get("usernames")).isEqualTo(expected);
            });
  }

  @Test
  void suspendedMember_isRejected() {
    TestFixtures.suspendMember(baseDsl, m2, 1L);
    assertThatThrownBy(() -> resolver.resolve(projectId, List.of(username(m1), username(m2))))
        .isInstanceOfSatisfying(
            IssueImportException.class,
            e -> assertThat(e.errors().get("usernames")).isEqualTo(username(m2)));
  }
}
