package com.workplace.user.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-371 — 서버(ai-agent)가 대신 실행할 에이전트 선택 규칙. 이슈·이슈 채팅 dispatcher 와 메시징 응답자 선택이 모두 이 규칙을 쓰므로, 외부
 * (EXTERNAL) 에이전트가 서버를 트리거하지 않는다는 보장은 여기서 DB 기준으로 검증한다(각 dispatcher 테스트는 이 빈을 스텁한다).
 */
@Transactional
class ServerAgentResolverTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ServerAgentResolver resolver;

  /** 후보 사용자 — WP-417 이후 서버 실행 에이전트는 이 워크스페이스(테넌트#1, 테스트 기본 GUC)에서 활성이어야 하므로 ACTIVE 멤버십도 둔다. */
  private UserSummary user(String kind, String runtime) {
    return user(kind, runtime, 1L);
  }

  private UserSummary user(String kind, String runtime, long tenantId) {
    String username = kind.toLowerCase() + "-" + UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, username)
            .set(USER.EMAIL, username + "@example.com")
            .set(USER.KIND, kind)
            .set(USER.AGENT_RUNTIME, runtime)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TestFixtures.addMember(dsl, id, tenantId);
    return new UserSummary(id, username, username, kind);
  }

  @Test
  void 외부_에이전트가_앞에_있어도_첫_내부_에이전트를_고른다() {
    UserSummary human = user("HUMAN", "INTERNAL");
    UserSummary external = user("AGENT", "EXTERNAL");
    UserSummary internal = user("AGENT", "INTERNAL");
    UserSummary internal2 = user("AGENT", "INTERNAL");

    assertThat(resolver.pickActingAgent(List.of(human, external, internal, internal2), 1L))
        .isEqualTo(internal.id());
    // 후보 순서를 따른다 — 뒤쪽 내부 에이전트가 먼저 오면 그쪽.
    assertThat(resolver.pickActingAgent(List.of(internal2, internal), 1L))
        .isEqualTo(internal2.id());
  }

  @Test
  void 외부_에이전트만_있거나_사람뿐이면_null() {
    UserSummary human = user("HUMAN", "INTERNAL");
    UserSummary external = user("AGENT", "EXTERNAL");

    assertThat(resolver.pickActingAgent(List.of(external), 1L)).isNull();
    assertThat(resolver.pickActingAgent(List.of(human), 1L)).isNull();
    assertThat(resolver.pickActingAgent(List.of(), 1L)).isNull();
  }

  @Test
  void id_기반_선택도_같은_규칙을_따른다() {
    UserSummary external = user("AGENT", "EXTERNAL");
    UserSummary internal = user("AGENT", "INTERNAL");
    // 요약 DTO 의 kind 를 믿지 않고 DB 의 kind 도 다시 본다 — 사람 id 가 섞여도 뽑히지 않는다.
    UserSummary human = user("HUMAN", "INTERNAL");

    assertThat(resolver.pickActingAgentId(List.of(external.id(), internal.id()), 1L))
        .isEqualTo(internal.id());
    assertThat(resolver.pickActingAgentId(List.of(human.id(), external.id()), 1L)).isNull();
    assertThat(resolver.pickActingAgentId(List.of(), 1L)).isNull();
  }

  @Test
  void 이_워크스페이스에서_정지된_내부_에이전트는_건너뛴다() {
    // WP-417: 멤버십 SUSPENDED 인 내부 에이전트는 활성으로 보지 않는다 — 다음 활성 내부 에이전트를 고른다.
    UserSummary suspended = user("AGENT", "INTERNAL");
    UserSummary internal = user("AGENT", "INTERNAL");
    TestFixtures.suspendMember(dsl, suspended.id(), 1L);

    assertThat(resolver.pickActingAgentId(List.of(suspended.id(), internal.id()), 1L))
        .isEqualTo(internal.id());
  }

  @Test
  void 테넌트_컨텍스트_없이도_넘긴_워크스페이스_기준으로_활성_내부_에이전트를_고른다() {
    // WP-417: 비동기 디스패처처럼 TenantContext·트랜잭션 GUC 와 무관하게, 인자로 넘긴 워크스페이스의 멤버십으로 판정해야 한다.
    // 테스트 GUC 는 테넌트#1 이므로, 다른 테넌트에만 속한 에이전트가 뽑히면 GUC 가 아니라 인자를 본 것이다.
    long other = TestFixtures.createTenant(dsl, "ACTIVE");
    UserSummary agent = user("AGENT", "INTERNAL", other);
    TenantContext.clear();

    assertThat(resolver.pickActingAgentId(List.of(agent.id()), other)).isEqualTo(agent.id());
    // 테넌트#1 기준이면 그 워크스페이스 멤버가 아니라 비활성 — 뽑히지 않는다.
    assertThat(resolver.pickActingAgentId(List.of(agent.id()), 1L)).isNull();
  }
}
