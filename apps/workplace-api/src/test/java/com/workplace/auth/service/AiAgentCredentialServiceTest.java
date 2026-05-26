package com.workplace.auth.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 5c-2 후속 (#33): AGENT OAuth 토큰 등록/회수/redeem 서비스 통합 테스트. */
@Transactional
class AiAgentCredentialServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AiAgentCredentialService service;
  @Autowired AiAgentCredentialRepository repo;

  private Long createUser(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    if ("HUMAN".equals(kind)) {
      dsl.update(USER).set(USER.PASSWORD, "pw").where(USER.ID.eq(id)).execute();
    }
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  @Test
  void register_new_token_creates_active_row() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    var meta = service.register(admin, agent, "X".repeat(64), "main");

    assertThat(meta.label()).isEqualTo("main");
    assertThat(meta.createdAt()).isNotNull();
    assertThat(repo.findActive(agent)).isPresent();
  }

  @Test
  void register_again_revokes_previous_active() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    service.register(admin, agent, "X".repeat(64), "first");

    var meta2 = service.register(admin, agent, "Y".repeat(64), "second");

    assertThat(meta2.label()).isEqualTo("second");
    assertThat(repo.findActive(agent)).isPresent();
    assertThat(repo.findActive(agent).get().label()).isEqualTo("second");
  }

  @Test
  void register_to_human_rejects_400() {
    Long admin = createUser("admin", "HUMAN");
    Long human = createUser("h", "HUMAN");

    assertThatThrownBy(() -> service.register(admin, human, "X".repeat(64), null))
        .isInstanceOf(KeyTargetMustBeAgentException.class);
  }

  @Test
  void revoke_makes_active_zero() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    service.register(admin, agent, "X".repeat(64), null);

    service.revoke(admin, agent);

    assertThat(repo.findActive(agent)).isEmpty();
  }

  @Test
  void revoke_idempotent_when_no_active() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    service.revoke(admin, agent);

    assertThat(repo.findActive(agent)).isEmpty();
  }

  @Test
  void redeem_self_returns_plaintext_and_touches_last_used() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String plaintext = "Z".repeat(64);
    service.register(admin, agent, plaintext, "main");

    var redeem = service.redeemSelf(agent);

    assertThat(redeem.token()).isEqualTo(plaintext);
    assertThat(redeem.label()).isEqualTo("main");
    assertThat(repo.findActive(agent).get().lastUsedAt()).isNotNull();
  }

  @Test
  void redeem_self_without_active_throws_404() {
    Long agent = createUser("ai", "AGENT");

    assertThatThrownBy(() -> service.redeemSelf(agent))
        .isInstanceOf(OAuthTokenNotFoundException.class);
  }
}
