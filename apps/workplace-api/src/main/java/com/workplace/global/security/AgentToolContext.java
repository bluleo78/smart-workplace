package com.workplace.global.security;

import java.util.Locale;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * 요청 범위 "수행 도구"(WP-377). genia-works MCP 가 보내는 X-Agent-Tool 값을 PAT·AI 키 인증 필터만 여기에 둔다 —
 * 브라우저(JWT)·Internal 요청은 값이 없어 AI 작업 자동 시작이 일어나지 않는다. TenantContext 처럼 필터 finally 에서 정리.
 */
public final class AgentToolContext {
  public static final String HEADER = "X-Agent-Tool";
  private static final Pattern VALID = Pattern.compile("^[a-z0-9-]{1,40}$");
  private static final ThreadLocal<String> TOOL = new ThreadLocal<>();
  private static final ThreadLocal<Boolean> SUPPRESS = new ThreadLocal<>();

  private AgentToolContext() {}

  /** 헤더 원문 → 저장 값. 비면 null(헤더 없음), 규칙 밖이면 "mcp"(MCP 요청인 건 확실하므로). */
  public static String normalize(String raw) {
    if (raw == null || raw.isBlank()) return null;
    String v = raw.trim().toLowerCase(Locale.ROOT);
    return VALID.matcher(v).matches() ? v : "mcp";
  }

  /** 현재 요청의 수행 도구를 설정한다(null 이면 제거). */
  public static void set(String tool) {
    if (tool == null) TOOL.remove();
    else TOOL.set(tool);
  }

  /** 현재 요청의 수행 도구. 없으면 null. */
  public static String current() {
    return TOOL.get();
  }

  /** 풀링된 스레드로 값이 새지 않도록 요청 종료 시 정리한다. */
  public static void clear() {
    TOOL.remove();
    SUPPRESS.remove();
  }

  /** 명시 보고 처리 중에는 부수 쓰기(상태 변경·챗 글)가 자동 터치를 일으키지 않게 한다 — 보고한 상태가 되돌려지지 않도록. */
  public static <T> T suppressTouch(Supplier<T> body) {
    Boolean prev = SUPPRESS.get();
    SUPPRESS.set(Boolean.TRUE);
    try {
      return body.get();
    } finally {
      if (prev == null) SUPPRESS.remove();
      else SUPPRESS.set(prev);
    }
  }

  /** 자동 터치가 억제 중인지. */
  public static boolean touchSuppressed() {
    return Boolean.TRUE.equals(SUPPRESS.get());
  }
}
