package com.workplace.member;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.member.dto.MemberSummary;
import com.workplace.member.service.MemberDirectoryService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.AgentUsernames;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 구성원 디렉터리 서비스 통합 테스트 (#833).
 *
 * <p>user/membership 은 RLS 비대상 전역 테이블이라 테넌트 경계가 코드로만 지켜진다. 따라서 "우리 테넌트 사람이 보인다"(양성)뿐 아니라 "다른 테넌트
 * 사람은 안 보인다"(음성)를 반드시 함께 단언한다 — 양성 케이스만으로는 경계가 사라져도 테스트가 통과한다.
 */
@Transactional
class MemberDirectoryServiceTest extends IntegrationTestBase {

  @Autowired MemberDirectoryService service;
  @Autowired DSLContext dsl;

  private long insider;
  private long outsider;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    insider = seedUser("dir_insider", "HUMAN", true);
    linkMembership(insider, 1L, "ACTIVE");
    // 다른 테넌트(2) 소속 — 테넌트#1 디렉터리에 절대 나오면 안 된다.
    outsider = seedUser("dir_outsider", "HUMAN", true);
    linkMembership(outsider, seedTenant(), "ACTIVE");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private long seedUser(String prefix, String kind, boolean active) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return seedNamed(prefix + "_" + suffix, prefix, kind, active);
  }

  /** username·이름을 그대로 지정해 만든다(정확일치 검증은 난수 접미사 없는 username 이 필요하다). */
  private long seedNamed(String username, String name, String kind, boolean active) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, username + "@example.com")
        .set(USER.KIND, kind)
        .set(USER.IS_ACTIVE, active)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private void linkMembership(long userId, long tenantId, String status) {
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, status)
        .execute();
  }

  /** 테스트용 보조 테넌트. 이름 충돌을 피하려 UUID 슬러그를 쓴다. */
  private long seedTenant() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(com.workplace.jooq.Tables.TENANT)
        .set(com.workplace.jooq.Tables.TENANT.NAME, "dir_tenant_" + suffix)
        .set(com.workplace.jooq.Tables.TENANT.SLUG, "dir-tenant-" + suffix)
        .set(com.workplace.jooq.Tables.TENANT.STATUS, "ACTIVE")
        .returning(com.workplace.jooq.Tables.TENANT.ID)
        .fetchOne()
        .getId();
  }

  private List<Long> listedIds(String search) {
    return service.list(search, "ALL", false, 0, 200).content().stream()
        .map(MemberSummary::userId)
        .toList();
  }

  /** WP-554: 자모가 분리된(NFD) 한글 검색어도 완성형(NFC) 이름의 구성원을 찾는다. */
  @Test
  void list_nfdSearch_findsNfcNamedMember() {
    String suffix = UUID.randomUUID().toString().substring(0, 6);
    long id = seedNamed("nfd_" + suffix, "김서연" + suffix, "HUMAN", true);
    linkMembership(id, 1L, "ACTIVE");
    String nfd = java.text.Normalizer.normalize("김서연" + suffix, java.text.Normalizer.Form.NFD);
    assertThat(listedIds(nfd)).contains(id);
  }

  @Test
  void list_includesTenantMember_excludesOtherTenant() {
    List<Long> ids = listedIds(null);
    assertThat(ids).contains(insider);
    assertThat(ids).doesNotContain(outsider);
  }

  @Test
  void list_search_doesNotLeakOtherTenantMember() {
    // 검색어로도 타 테넌트 사용자를 열거할 수 없어야 한다.
    assertThat(listedIds("dir_outsider")).isEmpty();
  }

  @Test
  void list_excludesInactiveAccountByDefault_butIncludesOnRequest() {
    long retired = seedUser("dir_retired", "HUMAN", false);
    linkMembership(retired, 1L, "ACTIVE");

    assertThat(listedIds(null)).doesNotContain(retired);
    List<Long> withInactive =
        service.list(null, "ALL", true, 0, 200).content().stream()
            .map(MemberSummary::userId)
            .toList();
    assertThat(withInactive).contains(retired);
  }

  @Test
  void list_excludesSuspendedMembership() {
    long suspended = seedUser("dir_suspended", "HUMAN", true);
    linkMembership(suspended, 1L, "SUSPENDED");
    assertThat(listedIds(null)).doesNotContain(suspended);
  }

  @Test
  void list_kindFilter_separatesHumanAndAgent() {
    long agent = seedUser("dir_agent", "AGENT", true);
    linkMembership(agent, 1L, "ACTIVE");

    List<Long> humans =
        service.list(null, "HUMAN", false, 0, 200).content().stream()
            .map(MemberSummary::userId)
            .toList();
    assertThat(humans).contains(insider).doesNotContain(agent);

    List<Long> agents =
        service.list(null, "AGENT", false, 0, 200).content().stream()
            .map(MemberSummary::userId)
            .toList();
    assertThat(agents).contains(agent).doesNotContain(insider);
  }

  @Test
  void list_hidesOtherMembersPersonalAssistant_butShowsMine() {
    // WP-638 — 개인 비서는 주인 전용. 남의 비서는 디렉터리·멘션 후보(kind=AGENT)에서 빠지고, 내 비서와 공용 에이전트는 남는다.
    long owner = seedUser("dir_owner", "HUMAN", true);
    linkMembership(owner, 1L, "ACTIVE");
    long othersAssistant =
        seedNamed(
            AgentUsernames.PERSONAL_ASSISTANT_PREFIX + owner, "Work Loop Admin", "AGENT", true);
    linkMembership(othersAssistant, 1L, "ACTIVE");
    long myAssistant =
        seedNamed(AgentUsernames.PERSONAL_ASSISTANT_PREFIX + insider, "내 비서", "AGENT", true);
    linkMembership(myAssistant, 1L, "ACTIVE");
    long workspaceAgent = seedUser("dir_agent", "AGENT", true);
    linkMembership(workspaceAgent, 1L, "ACTIVE");

    List<Long> agents =
        service.list(insider, null, "AGENT", false, 0, 200).content().stream()
            .map(MemberSummary::userId)
            .toList();
    assertThat(agents).contains(myAssistant, workspaceAgent).doesNotContain(othersAssistant);
    assertThat(service.list(insider, "Work Loop", "ALL", false, 0, 200).content()).isEmpty();
    // 단건 조회는 그대로 — 주인이 맡긴 이슈의 담당자 카드처럼 이미 보이는 자리에서는 열린다.
    assertThat(service.get(othersAssistant)).isPresent();
  }

  @Test
  void list_search_putsExactUsernameMatchOnFirstPage() {
    // #844: 부분일치 검색은 이름순이라, 같은 조각을 가진 사람이 많으면 정확히 그 아이디인 사람이 첫 페이지 밖으로 밀렸다.
    // 이름이 사전순으로 뒤인("zz…") 정확일치 대상 + 앞선 이름의 부분일치 5명 → 페이지 크기 3 에서도 첫 줄이어야 한다.
    String tag = "exact" + UUID.randomUUID().toString().substring(0, 6);
    for (int i = 0; i < 5; i++) {
      long noise = seedNamed(tag + "_noise" + i, "aa " + tag + i, "HUMAN", true);
      linkMembership(noise, 1L, "ACTIVE");
    }
    long target = seedNamed(tag, "zz 대상", "HUMAN", true);
    linkMembership(target, 1L, "ACTIVE");

    List<MemberSummary> page = service.list(tag, "ALL", false, 0, 3).content();
    assertThat(page).first().extracting(MemberSummary::userId).isEqualTo(target);
    // 대소문자 무시.
    assertThat(service.list(tag.toUpperCase(), "ALL", false, 0, 3).content())
        .first()
        .extracting(MemberSummary::userId)
        .isEqualTo(target);
  }

  @Test
  void get_returnsMember_butHidesOtherTenantUser() {
    assertThat(service.get(insider)).isPresent();
    // 존재 자체를 숨긴다 — 빈 값이어야 하며 예외로 "있긴 있다"를 알려주면 안 된다.
    assertThat(service.get(outsider)).isEmpty();
  }

  @Test
  void AI_는_설명과_실행_방식을_함께_돌려주고_사람은_실행_방식이_비어_있다() {
    // WP-455: 다른 AI 가 일을 맡길 상대를 고르려면 설명(역할)과, 맡겨도 시작하는지(실행 방식)를 알아야 한다.
    long reviewer = seedUser("dir_reviewer", "AGENT", true);
    linkMembership(reviewer, 1L, "ACTIVE");
    dsl.update(USER)
        .set(USER.DESCRIPTION, "코드 리뷰를 맡습니다")
        .set(USER.AGENT_RUNTIME, "EXTERNAL")
        .where(USER.ID.eq(reviewer))
        .execute();

    MemberSummary ai = service.get(reviewer).orElseThrow();
    assertThat(ai.description()).isEqualTo("코드 리뷰를 맡습니다");
    assertThat(ai.agentRuntime()).isEqualTo("EXTERNAL");
    // 목록도 같은 칸을 준다(MCP search_members 가 쓰는 경로).
    assertThat(service.list("dir_reviewer", "AGENT", false, 0, 50).content())
        .filteredOn(m -> m.userId() == reviewer)
        .singleElement()
        .satisfies(m -> assertThat(m.description()).isEqualTo("코드 리뷰를 맡습니다"));

    // 사람 행의 컬럼 기본값(INTERNAL)은 내보내지 않는다 — 실행 방식은 AI 에만 뜻이 있다.
    MemberSummary human = service.get(insider).orElseThrow();
    assertThat(human.agentRuntime()).isNull();
    assertThat(human.description()).isNull();
  }
}
