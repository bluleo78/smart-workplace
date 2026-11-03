package com.workplace.agentruntime.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.workplace.auth.service.AgentProviders;
import java.util.List;

/**
 * AI 실행 템플릿(WP-1246) — 「어떤 모습으로 AI 를 띄울지」를 적어 둔 묶음. 클래스패스 YAML({@code agent-templates/*.yaml})을 시작
 * 때 읽어 만든다. YAML 키는 camelCase 이고, 모르는 키는 오타를 잡으려 거부한다.
 *
 * @param kind SERVER(서버가 직접 답함 — 「기본」) 또는 WORKSPACE(작업 공간 컨테이너에서 실행 — 「Claude Code」)
 * @param image WORKSPACE 일 때 메인 컨테이너 이미지(SERVER 는 없음)
 * @param requires 이 템플릿이 쓰려면 AI 에게 갖춰져야 하는 것(예: claude, repo — 옛 이름 github 는 레지스트리가 repo 로 읽는다)
 * @param config 관리자가 고르는 실행 설정 칸
 */
public record AgentTemplate(
    String name,
    String version,
    String kind,
    Card card,
    String image,
    List<String> requires,
    List<ConfigField> config,
    Resources resources,
    List<Sidecar> sidecars,
    List<Plugin> plugins) {

  /** 목록·누락 값을 null 대신 빈 목록으로 맞춘다 — 소비 쪽이 null 검사를 하지 않게. */
  public AgentTemplate {
    requires = requires == null ? List.of() : List.copyOf(requires);
    config = config == null ? List.of() : List.copyOf(config);
    sidecars = sidecars == null ? List.of() : List.copyOf(sidecars);
    plugins = plugins == null ? List.of() : List.copyOf(plugins);
  }

  /**
   * 이 템플릿이 쓰는 AI 계정(provider) — requires 에서 정해진다(claude→anthropic, genia→genia, chatgpt→chatgpt,
   * 없으면 null). 표는 {@link AgentProviders} 한 곳. 응답 JSON 에는 {@code account} 로 나가지만 YAML 로 적을 수는
   * 없다(레지스트리가 거부한다 — requires 와 어긋난 값이 생기지 않게).
   */
  @JsonProperty("account")
  public String account() {
    return AgentProviders.accountOf(requires);
  }

  /** 화면 카드에 보이는 이름·설명·할 수 있는 일. */
  public record Card(String title, String description, List<String> skills) {
    public Card {
      skills = skills == null ? List.of() : List.copyOf(skills);
    }
  }

  /**
   * 실행 설정 칸 한 개.
   *
   * @param type select(options 중 하나) 또는 text(자유 입력)
   * @param defaultValue 비어 있을 때 채울 값(YAML 키 {@code default})
   * @param required true 면 빈 값을 허용하지 않는다
   */
  public record ConfigField(
      String key,
      String label,
      String type,
      List<Option> options,
      @JsonProperty("default") String defaultValue,
      boolean required) {
    public ConfigField {
      options = options == null ? List.of() : List.copyOf(options);
    }
  }

  /** select 칸의 선택지(저장 값 + 화면 이름). */
  public record Option(String value, String label) {}

  /** 컨테이너 자원 요청·상한과 작업 디스크 크기(쿠버네티스 수량 표기 그대로). */
  public record Resources(
      String cpuRequest,
      String memoryRequest,
      String cpuLimit,
      String memoryLimit,
      String workDisk) {}

  /** 메인 컨테이너 곁에 함께 띄우는 보조 컨테이너(예: 도커 데몬 dind). */
  public record Sidecar(String name, String image, boolean privileged) {}

  /** 컨테이너에 미리 깔 Claude Code 플러그인. */
  public record Plugin(String marketplace, String name, String version) {}
}
