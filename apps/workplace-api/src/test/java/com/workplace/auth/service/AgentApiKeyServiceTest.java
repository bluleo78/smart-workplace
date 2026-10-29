package com.workplace.auth.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.AgentApiKeyIssueResponse;
import com.workplace.auth.dto.AgentApiKeyResponse;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.exception.KeyNotFoundException;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.PersonalAssistantKeyIssueForbiddenException;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import com.workplace.user.exception.UserNotFoundException;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

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
    // WP-703: 키 API 는 대상이 이 워크스페이스 구성원일 때만 동작한다 — 실제 AI 처럼 멤버십을 준다.
    withMembership(humanId);
    withMembership(agentId);
  }

  @Test
  void issue_returns_plaintext_and_stores_hash() throws Exception {
    AgentApiKeyIssueResponse res = service.issue(adminId, agentId, new IssueAgentKeyRequest("ci"));
    assertThat(res.plaintextKey()).startsWith("ak_");
    assertThat(res.keyPrefix()).hasSize(12).isEqualTo(res.plaintextKey().substring(0, 12));
    // 해시는 응답에 없고 DB 만 — findActiveByHash 로 확인
    var active = repo.findActiveByHash(CapabilityTokens.sha256Hex(res.plaintextKey()));
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
    assertThat(repo.findActiveByHash(CapabilityTokens.sha256Hex(res.plaintextKey()))).isEmpty();
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

  // WP-1153: 관리자가 구성원의 개인 비서에게 키를 받으면 그 신원으로 주인의 개인 작업을 읽을 수 있었다 — 발급은 403, 이미 있던 키의 목록·회수는
  // 정리 수단으로 남는다.
  @Test
  void issue_to_personal_assistant_is_forbidden_but_existing_keys_stay_listable_and_revocable() {
    Long assistantId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, AgentUsernames.personalAssistantOf(humanId))
            .setNull(USER.PASSWORD)
            .set(USER.NAME, "개인 비서")
            .setNull(USER.EMAIL)
            .set(USER.KIND, UserKind.AGENT)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    withMembership(assistantId);
    // 막기 전에 발급돼 있던 키 — 목록에 보이고 회수할 수 있어야 한다.
    Long legacyKeyId = repo.insert(assistantId, "ak_legacy000", "legacy-hash", "old", adminId);

    assertThatThrownBy(() -> service.issue(adminId, assistantId, new IssueAgentKeyRequest("leak")))
        .isInstanceOf(PersonalAssistantKeyIssueForbiddenException.class);
    // WP-1162: 거절한 발급도 감사 로그 「실패」로 남고, 그 예외로 트랜잭션이 롤백 표시되지 않는다(표시되면 실제 요청에서는 기록이 함께 사라진다).
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .USER_ID
                    .eq(adminId)
                    .and(AUDIT_LOG.ACTION_TYPE.eq("AGENT_KEY_ISSUED"))
                    .and(AUDIT_LOG.RESULT.eq("FAILURE"))
                    .and(AUDIT_LOG.ERROR_MESSAGE.eq("PERSONAL_ASSISTANT"))))
        .isEqualTo(1);
    assertThat(TransactionSynchronizationManager.getResourceMap().values())
        .filteredOn(ConnectionHolder.class::isInstance)
        .isNotEmpty()
        .allSatisfy(h -> assertThat(((ConnectionHolder) h).isRollbackOnly()).isFalse());
    assertThat(service.list(assistantId))
        .extracting(AgentApiKeyResponse::id)
        .containsExactly(legacyKeyId);

    service.revoke(adminId, assistantId, legacyKeyId);
    // 목록이 비어 있어도 allSatisfy 는 통과하므로 크기도 함께 본다(WP-1162).
    assertThat(service.list(assistantId))
        .hasSize(1)
        .allSatisfy(k -> assertThat(k.revokedAt()).isNotNull());
  }
}
