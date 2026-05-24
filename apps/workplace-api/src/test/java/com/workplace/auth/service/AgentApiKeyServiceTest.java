package com.workplace.auth.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.AgentApiKeyIssueResponse;
import com.workplace.auth.dto.AgentApiKeyResponse;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.exception.KeyNotFoundException;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.UserKind;
import com.workplace.user.exception.UserNotFoundException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 5a — AgentApiKeyService 통합 테스트. */
@Transactional
class AgentApiKeyServiceTest extends IntegrationTestBase {

  @Autowired private AgentApiKeyService service;
  @Autowired private AgentApiKeyRepository repo;
  @Autowired private DSLContext dsl;

  private Long agentId;
  private Long humanId;
  private Long adminId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    adminId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "admin-" + n)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Admin")
            .set(USER.EMAIL, "admin-" + n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    humanId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "human-" + n)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Human")
            .set(USER.EMAIL, "human-" + n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    agentId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "agent-" + n)
            .setNull(USER.PASSWORD)
            .set(USER.NAME, "Agent")
            .set(USER.EMAIL, "agent-" + n + "@example.com")
            .set(USER.KIND, UserKind.AGENT)
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  private String sha256Hex(String plaintext) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-256");
    return HexFormat.of().formatHex(md.digest(plaintext.getBytes(StandardCharsets.UTF_8)));
  }

  @Test
  void issue_returns_plaintext_and_stores_hash() throws Exception {
    AgentApiKeyIssueResponse res = service.issue(adminId, agentId, new IssueAgentKeyRequest("ci"));
    assertThat(res.plaintextKey()).startsWith("ak_");
    assertThat(res.keyPrefix()).hasSize(12).isEqualTo(res.plaintextKey().substring(0, 12));
    // 해시는 응답에 없고 DB 만 — findActiveByHash 로 확인
    var active = repo.findActiveByHash(sha256Hex(res.plaintextKey()));
    assertThat(active).isPresent();
    assertThat(active.get().id()).isEqualTo(res.id());
    assertThat(active.get().userId()).isEqualTo(agentId);
  }

  @Test
  void issue_to_human_target_throws_400() {
    assertThatThrownBy(() -> service.issue(adminId, humanId, new IssueAgentKeyRequest(null)))
        .isInstanceOf(KeyTargetMustBeAgentException.class);
  }

  @Test
  void issue_to_unknown_user_throws_404() {
    assertThatThrownBy(() -> service.issue(adminId, 9_999_999L, new IssueAgentKeyRequest(null)))
        .isInstanceOf(UserNotFoundException.class);
  }

  @Test
  void list_returns_metadata_without_plaintext_or_hash() {
    service.issue(adminId, agentId, new IssueAgentKeyRequest("k1"));
    service.issue(adminId, agentId, new IssueAgentKeyRequest("k2"));
    List<AgentApiKeyResponse> keys = service.list(agentId);
    assertThat(keys).hasSize(2);
    // DTO 자체에 평문/해시 필드가 없음을 record 시그니처가 보장 — 여기서는 prefix/label 만 검증
    assertThat(keys).allSatisfy(k -> assertThat(k.keyPrefix()).startsWith("ak_"));
  }

  @Test
  void list_for_human_target_throws_400() {
    assertThatThrownBy(() -> service.list(humanId))
        .isInstanceOf(KeyTargetMustBeAgentException.class);
  }

  @Test
  void revoke_then_findActiveByHash_returns_empty() throws Exception {
    AgentApiKeyIssueResponse res = service.issue(adminId, agentId, new IssueAgentKeyRequest(null));
    service.revoke(adminId, agentId, res.id());
    assertThat(repo.findActiveByHash(sha256Hex(res.plaintextKey()))).isEmpty();
  }

  @Test
  void revoke_unknown_key_throws_404() {
    assertThatThrownBy(() -> service.revoke(adminId, agentId, 9_999_999L))
        .isInstanceOf(KeyNotFoundException.class);
  }

  @Test
  void revoke_with_mismatched_user_throws_404() {
    AgentApiKeyIssueResponse res = service.issue(adminId, agentId, new IssueAgentKeyRequest(null));
    assertThatThrownBy(() -> service.revoke(adminId, humanId, res.id()))
        .isInstanceOf(KeyNotFoundException.class);
  }
}
