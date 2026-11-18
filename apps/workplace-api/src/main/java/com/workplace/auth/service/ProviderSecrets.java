package com.workplace.auth.service;

import com.workplace.global.util.Texts;

/**
 * 계정 원문을 계정 종류의 규칙으로 정규화하는 한 곳(WP-1721) — 연결 등록({@link AiAgentCredentialService})·관리 경로 다리({@link
 * AdminProviderCredentialService})·AI 계정(agentaccount 의 등록·교체·이관 백필)이 모두 이것을 써서 같은 키가 저장소마다 다른
 * 원문·지문을 얻지 않게 한다. auth 에 두는 까닭은 auth 가 agentaccount 를 import 하지 않기 때문이다(반대 방향만 허용).
 */
public final class ProviderSecrets {

  private ProviderSecrets() {}

  /**
   * 원문을 종류의 규칙으로 정규화한다. 여러 번 적용해도 결과가 같다(이미 정규화한 값을 다시 넣어도 된다).
   *
   * <ul>
   *   <li>로그인형(genia·chatgpt): {@link LoginInfoNormalizer#normalize} — 그 프로그램이 읽는 키만 남긴
   *       auth.json(형식이 틀리면 400).
   *   <li>anthropic: 붙여 넣기에서 묻은 앞뒤 공백·개행·보이지 않는 문자(NBSP·U+200B·BOM 등)를 지운 토큰({@link
   *       Texts#stripInvisibleToNull}), 남는 것이 없으면 null. 그대로 두면 같은 토큰이 다른 지문을 얻어 같은 키의 AI 계정이 둘 생긴다.
   *       가운데 문자는 건드리지 않는다.
   *   <li>opencode: 그대로(설정 JSON 은 서버가 직렬화한 값이다).
   * </ul>
   *
   * @param provider 계정 종류 — null 은 anthropic({@link AgentProviders#normalize})
   */
  public static String normalize(String provider, String raw) {
    String p = AgentProviders.normalize(provider);
    if (AgentProviders.isLogin(p)) return LoginInfoNormalizer.normalize(p, raw);
    if (AgentProviders.ANTHROPIC.equals(p)) return Texts.stripInvisibleToNull(raw);
    return raw;
  }
}
