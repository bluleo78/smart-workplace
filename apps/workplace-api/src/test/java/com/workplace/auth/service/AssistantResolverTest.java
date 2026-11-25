package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.AssistantLimitWaitingException;
import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantLimitWaitRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.time.Instant;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class AssistantResolverTest extends IntegrationTestBase {

  @Autowired AssistantResolver resolver;
  @Autowired WorkspaceAssistantRepository workspaceRepo;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired AssistantConfigRepository configRepo;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired EncryptionService encryption;
  @Autowired WorkspaceAssistantService workspaceService;
  @Autowired AssistantLimitWaitRepository waitRepo;
  @Autowired DSLContext dsl;

  @Test
  void 둘다_미설정이면_예외() {
    long human = TestFixtures.createHuman(dsl);
    assertThatThrownBy(() -> resolver.resolve(human))
        .isInstanceOf(HomeAssistantNotConfiguredException.class);
  }

  @Test
  void 공용만_있으면_공용_그리고_디폴트_튜닝() {
    long human = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(agent, human);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(agent);
    assertThat(spec.model()).isEqualTo(AssistantDefaults.MODEL);
    assertThat(spec.thinkingDepth()).isEqualTo(AssistantDefaults.THINKING_DEPTH);
    assertThat(spec.maxTurns()).isEqualTo(AssistantDefaults.MAX_TURNS);
    assertThat(spec.timeoutMs()).isEqualTo(AssistantDefaults.TIMEOUT_MS);
  }

  @Test
  void 개인이_있으면_공용보다_우선_그리고_config_override() {
    long human = TestFixtures.createHuman(dsl);
    long workspaceAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(workspaceAgent, human);

    long personalAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    personalRepo.setAgentId(human, personalAgent);
    configRepo.upsert(personalAgent, "claude-opus-4-8", "MAX", null, null);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(personalAgent);
    assertThat(spec.model()).isEqualTo("claude-opus-4-8");
    assertThat(spec.thinkingDepth()).isEqualTo("MAX");
    assertThat(spec.maxTurns()).isEqualTo(AssistantDefaults.MAX_TURNS); // null override → default
  }

  @Test
  void 개인_지정됐지만_토큰없으면_공용으로_폴백() {
    long human = TestFixtures.createHuman(dsl);
    long workspaceAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(workspaceAgent, human);

    long personalAgentNoToken = TestFixtures.createAgentNoToken(dsl);
    personalRepo.setAgentId(human, personalAgentNoToken);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(workspaceAgent);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // resolveOrEmpty / resolveWorkspaceOrEmpty — Optional 변형 (이슈 요약 경로용)
  // ──────────────────────────────────────────────────────────────────────────

  @Test
  void resolveOrEmpty_개인비서_토큰있음_present() {
    long human = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    personalRepo.setAgentId(human, agent);

    var result = resolver.resolveOrEmpty(human);

    assertThat(result).isPresent();
    assertThat(result.get().agentUserId()).isEqualTo(agent);
  }

  @Test
  void resolveOrEmpty_토큰없는_후보만_있으면_empty() {
    long human = TestFixtures.createHuman(dsl);
    long agentNoToken = TestFixtures.createAgentNoToken(dsl);
    // 개인 비서만 지정(토큰 없음), 공용 비서 미설정 → 둘 다 pickWithActiveToken 통과 불가
    personalRepo.setAgentId(human, agentNoToken);

    var result = resolver.resolveOrEmpty(human);

    assertThat(result).isEmpty();
  }

  @Test
  void resolveWorkspaceOrEmpty_공용비서_토큰있음_present() {
    long admin = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    workspaceRepo.upsert(agent, admin);

    var result = resolver.resolveWorkspaceOrEmpty();

    assertThat(result).isPresent();
    assertThat(result.get().agentUserId()).isEqualTo(agent);
  }

  @Test
  void resolveWorkspaceOrEmpty_공용비서_미설정이면_empty() {
    // 공용 비서 행을 등록하지 않음 → empty
    var result = resolver.resolveWorkspaceOrEmpty();

    assertThat(result).isEmpty();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // resolvePersonalOrEmpty — 개인 전용(공통 비서 폴백 없음, 메일 개인 요약용)
  // ──────────────────────────────────────────────────────────────────────────

  @Test
  void resolvePersonalOrEmpty_공용비서만_있으면_empty() {
    // 공통 비서만 있고 개인 비서는 없는 사용자 → 개인 전용 해석은 empty(공통으로 폴백하지 않음)
    long human = TestFixtures.createHuman(dsl);
    long workspaceAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(workspaceAgent, human);

    assertThat(resolver.resolvePersonalOrEmpty(human)).isEmpty();
  }

  @Test
  void resolvePersonalOrEmpty_개인비서_토큰있으면_present() {
    // 개인 비서 + active token → present
    long human = TestFixtures.createHuman(dsl);
    long personalAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    personalRepo.setAgentId(human, personalAgent);

    assertThat(resolver.resolvePersonalOrEmpty(human)).isPresent();
  }

  /**
   * 로그인 정보 계정(genia·chatgpt)만 연결된 비서는 서버가 부를 수 없어 「토큰 없음」으로 본다(WP-1296·1297) — 개인 비서는 공용으로 폴백하고, 공용
   * 비서 상태도 토큰 없음이다.
   */
  @Test
  void pickWithActiveToken_whenOnlyLoginCredential_treatsAsNoToken() {
    long human = TestFixtures.createHuman(dsl);
    long workspaceAgent = TestFixtures.createAgentNoToken(dsl);
    workspaceRepo.upsert(workspaceAgent, human);
    credentialRepo.insert(
        workspaceAgent, "genia", encryption.encrypt("{\"genia\":{}}"), "g", human);
    long personalAgent = TestFixtures.createAgentNoToken(dsl);
    personalRepo.setAgentId(human, personalAgent);
    credentialRepo.insert(
        personalAgent, "chatgpt", encryption.encrypt("{\"tokens\":{}}"), "c", human);

    assertThat(resolver.resolveOrEmpty(human)).isEmpty();
    assertThat(resolver.resolvePersonalOrEmpty(human)).isEmpty();
    assertThat(workspaceService.get().hasActiveToken()).isFalse();

    // 공용 비서에 Claude 계정을 연결하면 그쪽으로 해석된다.
    credentialRepo.revokeActive(workspaceAgent);
    credentialRepo.insert(
        workspaceAgent, "anthropic", encryption.encrypt("T".repeat(64)), "a", human);
    assertThat(resolver.resolve(human).agentUserId()).isEqualTo(workspaceAgent);
    assertThat(workspaceService.get().hasActiveToken()).isTrue();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WP-2108 — 사용 한도 대기를 아는 해석. 테스트 트랜잭션 안에서 대기 행을 직접 넣는다(mark 는 새 트랜잭션이라 미커밋 픽스처를 못 본다).
  // ──────────────────────────────────────────────────────────────────────────

  private long credentialOf(long agent) {
    return credentialService.findServerUsableActive(agent).orElseThrow().id();
  }

  @Test
  void 개인비서_대기중이면_공용으로_넘어가지_않고_WAITING() {
    long human = TestFixtures.createHuman(dsl);
    long workspaceAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(workspaceAgent, human);
    long personalAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    personalRepo.setAgentId(human, personalAgent);
    Instant until = Instant.now().plus(Duration.ofHours(2));
    var marked = waitRepo.upsert(credentialOf(personalAgent), personalAgent, until, null);

    AssistantResolution r = resolver.resolution(human);

    assertThat(r.isWaiting()).isTrue();
    assertThat(r.isReady()).isFalse();
    assertThat(resolver.isWaiting(human)).isTrue();
    assertThat(r.limitWaitUntil()).isEqualTo(marked.untilAt());
    assertThat(resolver.resolveOrEmpty(human)).isEmpty();
    assertThat(resolver.resolvePersonalOrEmpty(human)).isEmpty();
    assertThatThrownBy(() -> resolver.resolve(human))
        .isInstanceOf(AssistantLimitWaitingException.class)
        .hasMessageStartingWith("사용 한도에 걸렸어요(");
    // 설정·가용성은 대기를 보지 않는다.
    assertThat(resolver.hasAssistant(human)).isTrue();
    assertThat(resolver.hasPersonalAssistant(human)).isTrue();
    // 공용 비서는 영향 없음.
    assertThat(resolver.workspaceResolution().isReady()).isTrue();
  }

  @Test
  void 공용비서_대기중이면_resolveWorkspaceOrEmpty_빈값_hasWorkspaceAssistant_true() {
    long admin = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    workspaceRepo.upsert(agent, admin);
    waitRepo.upsert(credentialOf(agent), agent, Instant.now().plus(Duration.ofHours(1)), null);

    assertThat(resolver.resolveWorkspaceOrEmpty()).isEmpty();
    assertThat(resolver.resolveForProject(false, null)).isEmpty();
    assertThat(resolver.projectResolution(false, null).isWaiting()).isTrue();
    assertThat(resolver.hasWorkspaceAssistant()).isTrue();
  }

  @Test
  void 대기가_지나면_다시_ready() {
    long admin = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    workspaceRepo.upsert(agent, admin);
    long cred = credentialOf(agent);
    waitRepo.upsert(cred, agent, Instant.now().plus(Duration.ofHours(1)), null);
    dsl.update(com.workplace.jooq.Tables.ASSISTANT_LIMIT_WAIT)
        .set(
            com.workplace.jooq.Tables.ASSISTANT_LIMIT_WAIT.UNTIL_AT,
            java.time.OffsetDateTime.now().minusMinutes(1))
        .where(com.workplace.jooq.Tables.ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(cred))
        .execute();

    assertThat(resolver.workspaceResolution().isReady()).isTrue();
    assertThat(resolver.resolveWorkspaceOrEmpty()).isPresent();
  }

  @Test
  void buildSpec_은_credentialId_를_싣는다() {
    long human = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    personalRepo.setAgentId(human, agent);

    assertThat(resolver.resolve(human).credentialId()).isEqualTo(credentialOf(agent));
    assertThat(resolver.resolution(human).credentialId()).isEqualTo(credentialOf(agent));
    assertThat(resolver.hasAssistant(TestFixtures.createHuman(dsl))).isFalse();
  }
}
