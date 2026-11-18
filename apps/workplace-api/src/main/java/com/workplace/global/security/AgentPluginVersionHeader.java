package com.workplace.global.security;

import java.util.regex.Pattern;

/**
 * genia-works 플러그인이 AI 키 요청에 싣는 자기 버전(WP-1707) — {@code X-Genia-Plugin-Version}. AI 키 인증 필터가 읽어 키마다
 * 기록하고, 관리 화면이 최신 버전과 견줘 「업데이트 필요」를 보인다.
 *
 * <p>값은 사용자가 마음대로 보낼 수 있으므로 점으로 나눈 숫자(예: 0.1.53)이고 32자 이하일 때만 받는다 — 화면·DB 에 엉뚱한 글자나 긴 문자열이 남지 않게. 그
 * 밖은 없는 것과 같다(기록하지 않고, 요청은 그대로 처리한다).
 */
public final class AgentPluginVersionHeader {

  public static final String HEADER = "X-Genia-Plugin-Version";

  /** DB 칸(plugin_version VARCHAR(32))과 같은 상한. */
  static final int MAX_LENGTH = 32;

  private static final Pattern VALID = Pattern.compile("^[0-9]+(\\.[0-9]+)*$");

  private AgentPluginVersionHeader() {}

  /** 헤더 원문 → 기록할 값. 없거나 형식이 아니면 null. */
  public static String normalize(String raw) {
    if (raw == null) return null;
    String v = raw.strip();
    if (v.isEmpty() || v.length() > MAX_LENGTH) return null;
    return VALID.matcher(v).matches() ? v : null;
  }
}
