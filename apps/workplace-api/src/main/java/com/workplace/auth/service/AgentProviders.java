package com.workplace.auth.service;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 비서 연결 provider(ai_agent_credential.provider) 정규화 규칙 한 곳(WP-139) — 미기록(NULL, V119 이전 레거시)·미지정 요청은
 * anthropic 으로 본다. 등록 요청 기본값·이전 연결 비교·추천 모델 결정이 같은 규칙을 쓰게 모았다.
 *
 * <p>WP-1296·1297: 「로그인 정보」 계정(genia·chatgpt)과 실행 템플릿의 requires 값 → 계정(provider) 표도 여기 한 곳에 둔다 —
 * 레지스트리 검증·desired·연결 등록 검사가 같은 표를 본다.
 */
public final class AgentProviders {

  /** Anthropic provider 값(Claude 구독 토큰). */
  public static final String ANTHROPIC = "anthropic";

  /** OpenAI 호환 provider 값(provider config JSON). */
  public static final String OPENCODE = "opencode";

  /** Gen:iA Code 가 쓰는 Gen:iA 로그인 정보(auth.json). */
  public static final String GENIA = "genia";

  /** Codex 가 쓰는 ChatGPT 로그인 정보(auth.json). */
  public static final String CHATGPT = "chatgpt";

  /** 계정을 누가 쓰는가 — SERVER: 서버(기본 실행 방식)가 직접 부른다, LOGIN: 그 프로그램 안에서만 쓰는 로그인 정보. */
  private enum Kind {
    SERVER,
    LOGIN
  }

  /**
   * provider 한 종류의 설명 — 이 표가 유일한 출처다.
   *
   * @param label 화면 이름(예외 문구용 — 웹 lib/agentAccount.ts 와 같은 이름)
   * @param requirement 이 계정을 요구하는 실행 템플릿 requires 값(없으면 null)
   * @param podLoginInfo 작업 공간 Pod 에 계정 정보를 파일(login-info — runner 의 login 비밀값)로 넘기는가(WP-1410). 로그인
   *     정보 계정과 OpenCode 템플릿이 쓰는 OpenAI 호환 연결이 그렇다. Claude 구독은 따로(claude 비밀값) 넘긴다
   */
  private record Descriptor(
      String provider, Kind kind, String label, String requirement, boolean podLoginInfo) {}

  private static final List<Descriptor> DESCRIPTORS =
      List.of(
          new Descriptor(ANTHROPIC, Kind.SERVER, "Claude 구독", "claude", false),
          new Descriptor(OPENCODE, Kind.SERVER, "OpenAI 호환", "opencode", true),
          new Descriptor(GENIA, Kind.LOGIN, "Gen:iA 로그인", "genia", true),
          new Descriptor(CHATGPT, Kind.LOGIN, "ChatGPT 로그인", "chatgpt", true));

  private static final Map<String, Descriptor> BY_PROVIDER =
      DESCRIPTORS.stream().collect(Collectors.toUnmodifiableMap(Descriptor::provider, d -> d));

  /** 실행 템플릿 requires 값 → 그 템플릿이 쓰는 계정(provider). 이 표 밖의 요구(repo)는 계정이 아니다. */
  private static final Map<String, String> ACCOUNT_BY_REQUIREMENT =
      DESCRIPTORS.stream()
          .filter(d -> d.requirement() != null)
          .collect(Collectors.toUnmodifiableMap(Descriptor::requirement, Descriptor::provider));

  /** 등록할 수 있는 provider 값 전부. */
  public static final Set<String> ALL = BY_PROVIDER.keySet();

  /** 계정을 요구하는 requires 값(claude·genia·chatgpt·opencode). */
  public static final Set<String> ACCOUNT_REQUIREMENTS = ACCOUNT_BY_REQUIREMENT.keySet();

  private AgentProviders() {}

  /** Anthropic 연결인가 — NULL 은 anthropic. */
  public static boolean isAnthropic(String provider) {
    return provider == null || ANTHROPIC.equals(provider);
  }

  /** 비교·저장용 정규화 — NULL 이면 anthropic, 그 외는 그대로. */
  public static String normalize(String provider) {
    return provider == null ? ANTHROPIC : provider;
  }

  /** 로그인 정보(프로그램의 auth.json)로 연결하는 계정인가 — ai-agent 에 Claude 토큰처럼 넘기면 안 된다. */
  public static boolean isLogin(String provider) {
    return kindOf(provider) == Kind.LOGIN;
  }

  /**
   * Pod 에 계정 정보를 파일(login-info)로 넘기는 계정인가(WP-1410) — 표의 {@code podLoginInfo} 칸(로그인 정보 계정
   * genia·chatgpt 와 OpenCode 템플릿이 쓰는 OpenAI 호환 연결). OpenAI 호환은 종류(Kind)가 SERVER 로 남는다 — 서버가 모델을
   * 실시간으로 조회하고 기본 방식도 쓰는 계정이라 {@link #isLogin} 이 되면 그 경로들이 깨진다. 그래서 「Pod 로 전달」 판정만 따로 둔다(runner 는
   * provider 를 보지 않고 같은 login 비밀값 경로를 쓴다).
   */
  public static boolean deliversLoginInfo(String provider) {
    Descriptor d = provider == null ? null : BY_PROVIDER.get(provider);
    return d != null && d.podLoginInfo();
  }

  /** 서버(기본 실행 방식)가 쓸 수 있는 계정인가 — NULL 은 anthropic. */
  public static boolean isServerUsable(String provider) {
    return kindOf(normalize(provider)) == Kind.SERVER;
  }

  private static Kind kindOf(String provider) {
    Descriptor d = provider == null ? null : BY_PROVIDER.get(provider);
    return d == null ? null : d.kind();
  }

  /** 실행 템플릿 requires 값 하나가 요구하는 계정 — 계정 요구가 아니면 null. */
  public static String accountForRequirement(String requirement) {
    return requirement == null ? null : ACCOUNT_BY_REQUIREMENT.get(requirement);
  }

  /** requires 목록이 요구하는 계정(첫 번째) — 없으면 null. 레지스트리가 계정 요구를 하나로 제한한다. */
  public static String accountOf(Collection<String> requires) {
    return requires.stream()
        .map(AgentProviders::accountForRequirement)
        .filter(a -> a != null)
        .findFirst()
        .orElse(null);
  }

  /** 계정 종류의 화면 이름 — 모르는 값이면 값 그대로. */
  public static String label(String provider) {
    String p = normalize(provider);
    Descriptor d = BY_PROVIDER.get(p);
    return d == null ? p : d.label();
  }
}
