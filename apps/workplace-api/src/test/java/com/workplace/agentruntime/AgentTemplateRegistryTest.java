package com.workplace.agentruntime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.exception.InvalidAgentConfigException;
import com.workplace.agentruntime.service.AgentTemplateRegistry;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

/**
 * WP-1246 실행 템플릿 레지스트리 단위 테스트 — YAML 파싱·시작 시 검증({@code load})과 실행 설정 검증({@code validateConfig}).
 * 스프링 컨텍스트 없이 순수 함수만 부른다.
 */
class AgentTemplateRegistryTest {

  private static final List<String> ALLOWED =
      List.of("docker.io/iacloudops/genia-works-agent-", "docker:");

  private static String resource(String name) throws IOException {
    return new String(
        new ClassPathResource("agent-templates/" + name).getInputStream().readAllBytes(),
        StandardCharsets.UTF_8);
  }

  private static AgentTemplate claudeCode() throws IOException {
    return AgentTemplateRegistry.load(List.of(resource("claude-code.yaml")), ALLOWED, "dev").get(0);
  }

  /** 최소 SERVER 템플릿 YAML — 검증 실패 케이스를 한 줄씩 바꿔 만들 때 바탕으로 쓴다. */
  private static String yaml(String name, String kind, String extra) {
    return "name: "
        + name
        + "\nversion: \"1\"\nkind: "
        + kind
        + "\ncard: { title: T, description: D }\n"
        + extra;
  }

  /** claude-code.yaml 의 모든 필드를 읽어 낸다. */
  @Test
  void load_whenValid_parsesAllFields() throws IOException {
    AgentTemplate t = claudeCode();

    assertThat(t.name()).isEqualTo("claude-code");
    assertThat(t.kind()).isEqualTo("WORKSPACE");
    assertThat(t.image()).isEqualTo("docker.io/iacloudops/genia-works-agent-claude-code:latest");
    assertThat(t.requires()).containsExactly("claude", "repo");
    assertThat(t.config()).hasSize(2);
    AgentTemplate.ConfigField model = t.config().get(0);
    assertThat(model.key()).isEqualTo("model");
    assertThat(model.type()).isEqualTo("select");
    assertThat(model.options())
        .extracting(AgentTemplate.Option::value)
        .containsExactly("opus", "sonnet");
    assertThat(model.defaultValue()).isEqualTo("opus");
    assertThat(model.required()).isTrue();
    AgentTemplate.ConfigField queue = t.config().get(1);
    assertThat(queue.key()).isEqualTo("queue");
    assertThat(queue.type()).isEqualTo("text");
    assertThat(queue.defaultValue()).isEqualTo("AI 개발팀");
    assertThat(queue.required()).isFalse();
    assertThat(t.resources())
        .isEqualTo(new AgentTemplate.Resources("4", "8Gi", "8", "16Gi", "50Gi"));
    assertThat(t.sidecars()).hasSize(1);
    assertThat(t.sidecars().get(0).name()).isEqualTo("dind");
    assertThat(t.sidecars().get(0).privileged()).isTrue();
    assertThat(t.plugins()).hasSize(8);
  }

  /** 옛 요구 이름 github 는 repo 와 같은 뜻으로 읽고, 둘이 함께 있으면 하나로 합친다(WP-1268). */
  @Test
  void load_whenRequiresUsesLegacyGithub_normalizesToRepo() {
    AgentTemplate legacy =
        AgentTemplateRegistry.load(
                List.of(yaml("a", "SERVER", "requires: [claude, github]\n")), ALLOWED, "dev")
            .get(0);
    assertThat(legacy.requires()).containsExactly("claude", "repo");

    AgentTemplate both =
        AgentTemplateRegistry.load(
                List.of(yaml("b", "SERVER", "requires: [github, repo]\n")), ALLOWED, "dev")
            .get(0);
    assertThat(both.requires()).containsExactly("repo");
  }

  /** 이미지 태그 자리표시는 API 릴리스 버전으로 채운다 — 같은 릴리스로 빌드된 작업 공간 이미지를 가리키게. */
  @Test
  void load_whenAppVersionGiven_fillsImageTag() throws IOException {
    AgentTemplate t =
        AgentTemplateRegistry.load(List.of(resource("claude-code.yaml")), ALLOWED, "0.9.40").get(0);

    assertThat(t.image()).isEqualTo("docker.io/iacloudops/genia-works-agent-claude-code:0.9.40");
  }

  /** 로컬·테스트(버전 dev·없음)는 latest 태그 — 존재하지 않는 dev 태그를 가리키지 않게. */
  @Test
  void load_whenDevOrBlankVersion_fallsBackToLatest() throws IOException {
    for (String v : new String[] {"dev", "", null}) {
      AgentTemplate t =
          AgentTemplateRegistry.load(List.of(resource("claude-code.yaml")), ALLOWED, v).get(0);
      assertThat(t.image()).endsWith(":latest");
    }
  }

  /** 번들된 템플릿(default·claude-code·genia-code)이 모두 검증을 통과한다. */
  @Test
  void load_whenBundledTemplates_allPass() throws IOException {
    List<AgentTemplate> all =
        AgentTemplateRegistry.load(
            List.of(
                resource("default.yaml"),
                resource("claude-code.yaml"),
                resource("genia-code.yaml")),
            ALLOWED,
            "dev");

    assertThat(all)
        .extracting(AgentTemplate::name)
        .containsExactly("claude-code", "default", "genia-code");
    assertThat(all.stream().filter(t -> t.name().equals("default")).findFirst().get().kind())
        .isEqualTo("SERVER");
  }

  /**
   * genia-code.yaml(WP-1296) — Gen:iA 로그인 계정(genia)·저장소 토큰을 요구하는 작업 공간 템플릿. 플러그인은 이미지에 굳힌 것을 쓰므로
   * 없고, 모델 기본값은 사용자가 정한 qwen3.8-27b-fp8 이다.
   */
  @Test
  void load_whenGeniaCodeTemplate_parsesGeniaAccountAndModels() throws IOException {
    AgentTemplate t =
        AgentTemplateRegistry.load(List.of(resource("genia-code.yaml")), ALLOWED, "0.9.40").get(0);

    assertThat(t.name()).isEqualTo("genia-code");
    assertThat(t.kind()).isEqualTo("WORKSPACE");
    assertThat(t.card().title()).isEqualTo("Gen:iA Code");
    assertThat(t.image()).isEqualTo("docker.io/iacloudops/genia-works-agent-genia-code:0.9.40");
    assertThat(t.requires()).containsExactly("genia", "repo");
    assertThat(t.account()).isEqualTo("genia");
    assertThat(t.plugins()).isEmpty();
    assertThat(t.sidecars()).extracting(AgentTemplate.Sidecar::name).containsExactly("dind");
    AgentTemplate.ConfigField model = t.config().get(0);
    assertThat(model.key()).isEqualTo("model");
    assertThat(model.options())
        .extracting(AgentTemplate.Option::value)
        .containsExactly("minimax-m2.7", "gpt-6-luna", "mimo-v2.6-flash", "qwen3.8-27b-fp8");
    assertThat(model.defaultValue()).isEqualTo("qwen3.8-27b-fp8");
  }

  /** 허용 레지스트리 밖 이미지는 시작 실패. */
  @Test
  void load_whenImageNotAllowed_throws() {
    String y =
        yaml("x", "WORKSPACE", "image: docker.io/evil/x\nresources: { cpuRequest: \"1\" }\n");

    assertThatThrownBy(() -> AgentTemplateRegistry.load(List.of(y), ALLOWED, "dev"))
        .isInstanceOf(IllegalStateException.class);
  }

  /** 같은 이름의 템플릿이 둘이면 시작 실패. */
  @Test
  void load_whenDuplicateName_throws() {
    String a = yaml("dup", "SERVER", "");
    String b = yaml("dup", "SERVER", "");

    assertThatThrownBy(() -> AgentTemplateRegistry.load(List.of(a, b), ALLOWED, "dev"))
        .isInstanceOf(IllegalStateException.class);
  }

  /** 선택지 없는 select 칸은 시작 실패. */
  @Test
  void load_whenSelectWithoutOptions_throws() {
    String y = yaml("x", "SERVER", "config:\n  - { key: m, label: M, type: select }\n");

    assertThatThrownBy(() -> AgentTemplateRegistry.load(List.of(y), ALLOWED, "dev"))
        .isInstanceOf(IllegalStateException.class);
  }

  /** 작업 공간 템플릿에 이미지가 없으면 시작 실패. */
  @Test
  void load_whenWorkspaceKindWithoutImage_throws() {
    String y = yaml("x", "WORKSPACE", "resources: { cpuRequest: \"1\" }\n");

    assertThatThrownBy(() -> AgentTemplateRegistry.load(List.of(y), ALLOWED, "dev"))
        .isInstanceOf(IllegalStateException.class);
  }

  /** 빈 입력은 기본값으로 채워진다. */
  @Test
  void validateConfig_fillsDefaults() throws IOException {
    Map<String, String> out = AgentTemplateRegistry.validateConfig(claudeCode(), Map.of());

    assertThat(out).containsEntry("model", "opus").containsEntry("queue", "AI 개발팀").hasSize(2);
  }

  /** 템플릿에 없는 키는 거부. */
  @Test
  void validateConfig_whenUnknownKey_throws() throws IOException {
    AgentTemplate t = claudeCode();

    assertThatThrownBy(() -> AgentTemplateRegistry.validateConfig(t, Map.of("nope", "x")))
        .isInstanceOf(InvalidAgentConfigException.class);
  }

  /** select 값이 선택지 밖이면 거부. */
  @Test
  void validateConfig_whenSelectValueNotInOptions_throws() throws IOException {
    AgentTemplate t = claudeCode();

    assertThatThrownBy(() -> AgentTemplateRegistry.validateConfig(t, Map.of("model", "gpt")))
        .isInstanceOf(InvalidAgentConfigException.class);
  }

  /** 기본값 없는 필수 text 칸이 비면 거부. */
  @Test
  void validateConfig_whenRequiredTextBlank_throws() {
    AgentTemplate t =
        AgentTemplateRegistry.load(
                List.of(
                    yaml(
                        "x",
                        "SERVER",
                        "config:\n  - { key: q, label: 라벨, type: text, required: true }\n")),
                ALLOWED,
                "dev")
            .get(0);

    assertThatThrownBy(() -> AgentTemplateRegistry.validateConfig(t, Map.of("q", "  ")))
        .isInstanceOf(InvalidAgentConfigException.class);
  }

  /** select 값은 앞뒤 공백을 지운 뒤 선택지와 비교한다 — text 칸처럼 다듬은 값으로 저장된다. */
  @Test
  void validateConfig_whenSelectValueHasSurroundingSpaces_acceptsTrimmed() throws IOException {
    Map<String, String> out =
        AgentTemplateRegistry.validateConfig(claudeCode(), Map.of("model", " sonnet "));

    assertThat(out).containsEntry("model", "sonnet");
  }

  /** requires 에 모르는 값(오타 등)이 있으면 시작 실패(WP-1296·1297). */
  @Test
  void load_whenUnknownRequirement_fails() {
    assertThatThrownBy(
            () ->
                AgentTemplateRegistry.load(
                    List.of(yaml("a", "SERVER", "requires: [claude, docker]\n")), ALLOWED, "dev"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("docker");
  }

  /** AI 계정을 둘 요구하면 시작 실패 — 한 AI 의 활성 연결은 하나다. */
  @Test
  void load_whenTwoAccounts_fails() {
    assertThatThrownBy(
            () ->
                AgentTemplateRegistry.load(
                    List.of(yaml("a", "SERVER", "requires: [claude, chatgpt]\n")), ALLOWED, "dev"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("하나만");
  }

  /** account 는 requires 에서 정해진다 — YAML 에 적으면 시작 실패. */
  @Test
  void load_whenAccountKeyWritten_fails() {
    assertThatThrownBy(
            () ->
                AgentTemplateRegistry.load(
                    List.of(yaml("a", "SERVER", "requires: [genia]\naccount: chatgpt\n")),
                    ALLOWED,
                    "dev"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("account");
  }

  /** account — claude→anthropic, genia→genia, chatgpt→chatgpt, 계정 요구 없음→null. */
  @Test
  void account_isDerivedFromRequires() throws IOException {
    List<AgentTemplate> ts =
        AgentTemplateRegistry.load(
            List.of(
                yaml("g", "SERVER", "requires: [genia, repo]\n"),
                yaml("c", "SERVER", "requires: [chatgpt]\n"),
                yaml("n", "SERVER", "requires: [repo]\n")),
            ALLOWED,
            "dev");

    assertThat(claudeCode().account()).isEqualTo("anthropic");
    assertThat(ts)
        .extracting(AgentTemplate::name, AgentTemplate::account)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple("c", "chatgpt"),
            org.assertj.core.groups.Tuple.tuple("g", "genia"),
            org.assertj.core.groups.Tuple.tuple("n", null));
  }
}
