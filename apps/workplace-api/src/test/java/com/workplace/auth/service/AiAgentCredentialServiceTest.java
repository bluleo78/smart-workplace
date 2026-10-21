package com.workplace.auth.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.exception.UnsafeProbeUrlException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 5c-2 후속 (#33), 멀티 프로바이더(#opencode) 확장: AGENT 프로바이더 자격증명 등록/회수/redeem 서비스 통합 테스트. */
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

    var meta = service.register(admin, agent, "anthropic", "X".repeat(64), "main", null);

    assertThat(meta.label()).isEqualTo("main");
    assertThat(meta.provider()).isEqualTo("anthropic");
    assertThat(meta.createdAt()).isNotNull();
    assertThat(repo.findActive(agent)).isPresent();
  }

  @Test
  void register_again_revokes_previous_active() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    service.register(admin, agent, "anthropic", "X".repeat(64), "first", null);

    var meta2 = service.register(admin, agent, "anthropic", "Y".repeat(64), "second", null);

    assertThat(meta2.label()).isEqualTo("second");
    assertThat(repo.findActive(agent)).isPresent();
    assertThat(repo.findActive(agent).get().label()).isEqualTo("second");
  }

  @Test
  void register_to_human_rejects_400() {
    Long admin = createUser("admin", "HUMAN");
    Long human = createUser("h", "HUMAN");

    assertThatThrownBy(
            () -> service.register(admin, human, "anthropic", "X".repeat(64), null, null))
        .isInstanceOf(KeyTargetMustBeAgentException.class);
  }

  @Test
  void revoke_makes_active_zero() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    service.register(admin, agent, "anthropic", "X".repeat(64), null, null);

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
    service.register(admin, agent, "anthropic", plaintext, "main", null);

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

  @Test // opencode 자격증명 등록 → provider/baseUrl 메타 노출 + model 동시 저장
  void registerOpencodeCredential_savesProviderAndModel() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String cfg =
        """
        {"providerId":"bedrock","options":{"baseURL":"https://ep.example/openai/v1","apiKey":"sk-test-123456789012345678901234"}}""";

    var meta = service.register(admin, agent, "opencode", cfg, "bedrock", "bedrock/gpt-oss-120b");

    assertThat(meta.provider()).isEqualTo("opencode");
    assertThat(meta.baseUrl()).isEqualTo("https://ep.example/openai/v1");

    var redeemed = service.redeemSelf(agent);
    assertThat(redeemed.provider()).isEqualTo("opencode");
    assertThat(redeemed.payload()).contains("\"apiKey\"");
    assertThat(redeemed.token()).isNull();
    assertThat(redeemed.model()).isEqualTo("bedrock/gpt-oss-120b");
  }

  @Test // anthropic 등록(최초, model 미설정 상태)은 정적 기본 모델(claude-sonnet-5)을 채운다
  void registerAnthropicCredential_defaultsModelWhenUnset() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    service.register(admin, agent, "anthropic", "X".repeat(64), "main", null);

    assertThat(service.redeemSelf(agent).model()).isEqualTo(AssistantDefaults.MODEL);
  }

  @Test // opencode → anthropic 전환 시 이전 provider 형식의 stale model 문자열을 기본값으로 덮어쓴다
  void registerAnthropicCredential_overridesStaleOpencodeModel() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String cfg =
        """
        {"providerId":"bedrock","options":{"baseURL":"https://ep.example/openai/v1","apiKey":"sk-test-123456789012345678901234"}}""";
    service.register(admin, agent, "opencode", cfg, "bedrock", "bedrock/gpt-oss-120b");

    service.register(admin, agent, "anthropic", "X".repeat(64), "main", null);

    assertThat(service.redeemSelf(agent).model()).isEqualTo(AssistantDefaults.MODEL);
  }

  @Test // 기존 anthropic 경로 무변경: token 등록 → redeem 시 provider=anthropic + token 반환
  void registerAnthropicToken_redeemsAsAnthropicProvider() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    service.register(admin, agent, "anthropic", "sk-ant-oat-".repeat(4), "main", null);
    var redeemed = service.redeemSelf(agent);

    assertThat(redeemed.provider()).isEqualTo("anthropic");
    assertThat(redeemed.token()).startsWith("sk-ant-oat-");
    assertThat(redeemed.payload()).isNull();
  }

  @Test // opencode 등록인데 model 누락 → 400
  void registerOpencodeWithoutModel_throws() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String cfg =
        """
        {"providerId":"bedrock","options":{"baseURL":"https://ep.example/openai/v1","apiKey":"sk-test-123456789012345678901234"}}""";

    assertThatThrownBy(() -> service.register(admin, agent, "opencode", cfg, "bedrock", null))
        .isInstanceOf(InvalidProviderCredentialException.class);
  }

  @Test // provider 허용값 외 → 400
  void registerUnknownProvider_throws() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    assertThatThrownBy(() -> service.register(admin, agent, "gemini", "X".repeat(64), "main", null))
        .isInstanceOf(InvalidProviderCredentialException.class);
  }

  @Test // anthropic 등록인데 token 이 blank/null → 400 (opencode-model-missing 과 대칭되는 회귀 테스트)
  void registerAnthropicWithBlankToken_throws() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    assertThatThrownBy(() -> service.register(admin, agent, "anthropic", "   ", "main", null))
        .isInstanceOf(InvalidProviderCredentialException.class);
    assertThatThrownBy(() -> service.register(admin, agent, "anthropic", null, "main", null))
        .isInstanceOf(InvalidProviderCredentialException.class);
  }

  @Test // decryptActivePayload 는 redeemSelf 와 동일한 평문을 반환하되 last_used_at 을 건드리지 않는다.
  void decryptActivePayload_returnsPlaintext_withoutTouchingLastUsed() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String plaintext = "Z".repeat(64);
    service.register(admin, agent, "anthropic", plaintext, "main", null);
    assertThat(repo.findActive(agent).get().lastUsedAt()).isNull();

    var result = service.decryptActivePayload(agent);

    assertThat(result.token()).isEqualTo(plaintext);
    assertThat(result.label()).isEqualTo("main");
    assertThat(repo.findActive(agent).get().lastUsedAt()).isNull();
  }

  @Test // decryptActivePayload 도 없으면 404(redeemSelf 와 동일 계약)
  void decryptActivePayload_withoutActive_throws404() {
    Long agent = createUser("ai", "AGENT");

    assertThatThrownBy(() -> service.decryptActivePayload(agent))
        .isInstanceOf(OAuthTokenNotFoundException.class);
  }

  @Test // 등록 시점에도 GET .../models 프로브와 동일한 SSRF 정책 적용 — 공인 IP/도메인 http:// 는 등록 자체가 400
  void registerOpencodeWithPublicHttpBaseUrl_throws400() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String cfg =
        """
        {"providerId":"bedrock","options":{"baseURL":"http://api.openai.com/v1","apiKey":"sk-test-123456789012345678901234"}}""";

    assertThatThrownBy(
            () ->
                service.register(admin, agent, "opencode", cfg, "bedrock", "bedrock/gpt-oss-120b"))
        .isInstanceOf(UnsafeProbeUrlException.class);
  }

  @Test // 회귀 방지: https:// baseURL 은 여전히 등록 성공
  void registerOpencodeWithHttpsBaseUrl_succeeds() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String cfg =
        """
        {"providerId":"bedrock","options":{"baseURL":"https://ep.example/openai/v1","apiKey":"sk-test-123456789012345678901234"}}""";

    var meta = service.register(admin, agent, "opencode", cfg, "bedrock", "bedrock/gpt-oss-120b");

    assertThat(meta.baseUrl()).isEqualTo("https://ep.example/openai/v1");
  }

  @Test // WP-596: 사설망 주소는 허용 목록에 없으면 http·https 모두 등록 거절(SSRF — 서버가 사내망을 대신 두드린다)
  void registerOpencodeWithPrivateNetworkBaseUrl_throws400() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    for (String url :
        new String[] {
          "http://192.168.1.10:8080/v1", "https://169.254.169.254/latest", "https://127.0.0.1/v1"
        }) {
      String cfg =
          "{\"providerId\":\"bedrock\",\"options\":{\"baseURL\":\""
              + url
              + "\",\"apiKey\":\"sk-test-123456789012345678901234\"}}";
      assertThatThrownBy(
              () ->
                  service.register(
                      admin, agent, "opencode", cfg, "bedrock", "bedrock/gpt-oss-120b"))
          .as(url)
          .isInstanceOf(UnsafeProbeUrlException.class);
    }
  }

  /** vision 케이스 공용 — opencode config JSON 에 vision 조각(`"vision":...`)을 붙여 등록한다. */
  private String cfgWithVision(String visionFragment) {
    return "{\"providerId\":\"custom\",\"options\":{\"baseURL\":\"https://ep.example/v1\","
        + "\"apiKey\":\"sk-test-123456789012345678901234\"}"
        + (visionFragment == null ? "" : ",\"vision\":" + visionFragment)
        + "}";
  }

  @Test // WP-250: 모델별 vision 설정은 저장되어 redeem(ai-agent 로 내려가는 경로)에 그대로 남는다
  void registerOpencodeWithPerModelVision_keptInRedeemPayload() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String cfg = cfgWithVision("{\"custom/qwen3.6-35b-vl\":true,\"custom/text-only\":false}");

    service.register(admin, agent, "opencode", cfg, "custom", "custom/qwen3.6-35b-vl");

    var vision = new ObjectMapper().readTree(service.redeemSelf(agent).payload()).get("vision");
    assertThat(vision.get("custom/qwen3.6-35b-vl").asBoolean()).isTrue();
    assertThat(vision.get("custom/text-only").asBoolean()).isFalse();
  }

  @Test // WP-250: boolean vision(전 모델 공통)도 그대로 보존
  void registerOpencodeWithBooleanVision_keptInRedeemPayload() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    service.register(admin, agent, "opencode", cfgWithVision("true"), "custom", "custom/m");

    var vision = new ObjectMapper().readTree(service.redeemSelf(agent).payload()).get("vision");
    assertThat(vision.isBoolean()).isTrue();
    assertThat(vision.asBoolean()).isTrue();
  }

  @Test // WP-250: vision 이 없거나 null 이면 기존과 동일하게 등록되고 payload 에 값이 없다(자동 감지)
  void registerOpencodeWithoutVision_succeeds() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    service.register(admin, agent, "opencode", cfgWithVision(null), "custom", "custom/m");
    var none = new ObjectMapper().readTree(service.redeemSelf(agent).payload());
    assertThat(none.hasNonNull("vision")).isFalse();

    service.register(admin, agent, "opencode", cfgWithVision("null"), "custom", "custom/m");
    var nul = new ObjectMapper().readTree(service.redeemSelf(agent).payload());
    assertThat(nul.hasNonNull("vision")).isFalse();
  }

  @Test // WP-250: vision 이 boolean·모델별 boolean 맵이 아니면 400
  void registerOpencodeWithInvalidVision_throws400() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    for (String bad : new String[] {"\"yes\"", "{\"m\":\"yes\"}", "1", "[true]", "{\"m\":null}"}) {
      assertThatThrownBy(
              () ->
                  service.register(
                      admin, agent, "opencode", cfgWithVision(bad), "custom", "custom/m"))
          .as("vision=%s", bad)
          .isInstanceOf(InvalidProviderCredentialException.class)
          .hasMessage("vision 은 true/false 또는 모델별 true/false 여야 합니다");
    }
  }
}
