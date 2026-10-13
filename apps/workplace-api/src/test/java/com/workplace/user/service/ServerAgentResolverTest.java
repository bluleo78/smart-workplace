package com.workplace.user.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.UserSummary;
import com.workplace.support.IntegrationTestBase;
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

  /** "user" 는 RLS 없는 전역 테이블이라 테넌트 멤버십 없이 행만 만들면 된다. */
  private UserSummary user(String kind, String runtime) {
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
    return new UserSummary(id, username, username, kind);
  }

  @Test
  void 외부_에이전트가_앞에_있어도_첫_내부_에이전트를_고른다() {
    UserSummary human = user("HUMAN", "INTERNAL");
    UserSummary external = user("AGENT", "EXTERNAL");
    UserSummary internal = user("AGENT", "INTERNAL");
    UserSummary internal2 = user("AGENT", "INTERNAL");

    assertThat(resolver.pickActingAgent(List.of(human, external, internal, internal2)))
        .isEqualTo(internal.id());
    // 후보 순서를 따른다 — 뒤쪽 내부 에이전트가 먼저 오면 그쪽.
    assertThat(resolver.pickActingAgent(List.of(internal2, internal))).isEqualTo(internal2.id());
  }

  @Test
  void 외부_에이전트만_있거나_사람뿐이면_null() {
    UserSummary human = user("HUMAN", "INTERNAL");
    UserSummary external = user("AGENT", "EXTERNAL");

    assertThat(resolver.pickActingAgent(List.of(external))).isNull();
    assertThat(resolver.pickActingAgent(List.of(human))).isNull();
    assertThat(resolver.pickActingAgent(List.of())).isNull();
  }

  @Test
  void id_기반_선택도_같은_규칙을_따른다() {
    UserSummary external = user("AGENT", "EXTERNAL");
    UserSummary internal = user("AGENT", "INTERNAL");
    // 요약 DTO 의 kind 를 믿지 않고 DB 의 kind 도 다시 본다 — 사람 id 가 섞여도 뽑히지 않는다.
    UserSummary human = user("HUMAN", "INTERNAL");

    assertThat(resolver.pickActingAgentId(List.of(external.id(), internal.id())))
        .isEqualTo(internal.id());
    assertThat(resolver.pickActingAgentId(List.of(human.id(), external.id()))).isNull();
    assertThat(resolver.pickActingAgentId(List.of())).isNull();
  }
}
