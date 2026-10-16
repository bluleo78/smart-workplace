package com.workplace.home.exception;

import com.workplace.home.service.AiMemoryScope;
import com.workplace.home.service.AiMemoryService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * AI 메모리(WP-55) 요청 거절 — HTTP 상태와 사유 코드를 함께 싣는다. 웹·ai-agent 는 {@code errors.code} 로 사유를 가른다(상태만으로는
 * "가득 참"과 "꺼짐"이 같은 409 라 구분되지 않는다). WP-379: 가득 참은 어느 범위인지 {@code errors.scope} 로도 싣는다.
 */
public class AiMemoryException extends RuntimeException {

  public static final String INVALID = "AI_MEMORY_INVALID";
  public static final String NOT_FOUND = "AI_MEMORY_NOT_FOUND";
  public static final String FULL = "AI_MEMORY_FULL";
  public static final String DISABLED = "AI_MEMORY_DISABLED";
  public static final String GONE = "AI_MEMORY_GONE";
  public static final String CHANGED = "AI_MEMORY_CHANGED";
  public static final String PIN_FULL = "AI_MEMORY_PIN_FULL";
  public static final String PIN_USER_ONLY = "AI_MEMORY_PIN_USER_ONLY";
  public static final String CHANGE_UNDONE = "AI_MEMORY_CHANGE_UNDONE";
  public static final String CHANGE_USER_ONLY = "AI_MEMORY_CHANGE_USER_ONLY";

  private final HttpStatus status;
  private final String code;

  /** FULL 일 때 가득 찬 범위(앱 코드 또는 {@link AiMemoryScope#COMMON}) — 그 외 null. */
  private final String scope;

  private AiMemoryException(HttpStatus status, String code, String message, String scope) {
    super(message);
    this.status = status;
    this.code = code;
    this.scope = scope;
  }

  private AiMemoryException(HttpStatus status, String code, String message) {
    this(status, code, message, null);
  }

  /** 길이·종류·범위·빈 값 등 입력 오류(400). 잘라서 저장하지 않는다 — 뜻이 바뀌므로. */
  public static AiMemoryException invalid(String message) {
    return new AiMemoryException(HttpStatus.BAD_REQUEST, INVALID, message);
  }

  /** 없거나 다른 사용자의 메모리·메시지(404) — 존재를 드러내지 않는다. */
  public static AiMemoryException notFound() {
    return new AiMemoryException(HttpStatus.NOT_FOUND, NOT_FOUND, "메모리를 찾을 수 없어요");
  }

  /**
   * 범위마다 유효 메모리 상한(300) 초과(409, WP-379·383). 앱 범위면 메시지에 범위 이름을 넣는다 — ai-agent 도구 오류를 받은 AI 가 "이슈
   * 메모리가 가득 찼어요"라고 안내하게. 조용히 버리지 않는다.
   *
   * @param scope 가득 찬 범위(null = 공통)
   */
  public static AiMemoryException full(String scope) {
    String prefix = scope == null ? "" : AiMemoryScope.label(scope) + " ";
    return new AiMemoryException(
        HttpStatus.CONFLICT,
        FULL,
        prefix + "메모리가 가득 찼어요(최대 " + AiMemoryService.LIMIT + "개). 필요 없는 항목을 지워 주세요",
        scope == null ? AiMemoryScope.COMMON : scope);
  }

  /** 범위마다 고정 상한(10) 초과(409, WP-383 판정 1) — 가득 참과 같이 errors.scope 를 싣는다(웹이 범위 이름으로 안내). */
  public static AiMemoryException pinFull(String scope) {
    String prefix = scope == null ? "" : AiMemoryScope.label(scope) + " ";
    return new AiMemoryException(
        HttpStatus.CONFLICT,
        PIN_FULL,
        prefix + "메모리 고정은 최대 " + AiMemoryService.PIN_LIMIT + "개예요. 다른 고정을 풀어 주세요",
        scope == null ? AiMemoryScope.COMMON : scope);
  }

  /** AI 대행의 고정 시도(403, WP-383 판정 2) — 고정은 사용자가 설정 화면에서만 한다. */
  public static AiMemoryException pinUserOnly() {
    return new AiMemoryException(HttpStatus.FORBIDDEN, PIN_USER_ONLY, "고정은 사용자가 설정에서만 할 수 있어요");
  }

  /** 메모리를 끈 사용자에 대한 AI 대행 쓰기(409). 설정 화면 직접 관리는 허용된다. */
  public static AiMemoryException disabled() {
    return new AiMemoryException(HttpStatus.CONFLICT, DISABLED, "사용자가 메모리를 꺼 두었어요. 메모리 도구를 쓰지 마세요");
  }

  /** 되돌릴 대상(고친 메모리)이 이미 지워졌다(404). */
  public static AiMemoryException gone() {
    return new AiMemoryException(HttpStatus.NOT_FOUND, GONE, "이미 지워진 메모리예요");
  }

  /** 되돌릴 고침 뒤에 메모리가 다시 바뀌었다(409) — 되돌리면 그 뒤의 수정을 조용히 덮으므로 거절한다. */
  public static AiMemoryException changed() {
    return new AiMemoryException(HttpStatus.CONFLICT, CHANGED, "그 뒤에 바뀐 메모리라 되돌리지 않았어요");
  }

  /** 이미 되돌린 정리 기록(409, WP-385) — 같은 기록을 두 번 되돌리지 않는다. */
  public static AiMemoryException changeUndone() {
    return new AiMemoryException(HttpStatus.CONFLICT, CHANGE_UNDONE, "이미 되돌린 기록이에요");
  }

  /** 403 — 「AI가 정리한 기록」 되돌리기는 사용자 전용(AI 대행이 사용자 대신 정리를 뒤집지 못하게, 고정과 같은 규칙). */
  public static AiMemoryException changeUserOnly() {
    return new AiMemoryException(
        HttpStatus.FORBIDDEN, CHANGE_USER_ONLY, "AI가 정리한 기록은 사용자가 설정에서만 되돌릴 수 있어요");
  }

  /** 응답에 쓸 HTTP 상태. */
  public HttpStatus status() {
    return status;
  }

  /** errors.code 로 싣는 사유 코드(AI_MEMORY_*). */
  public String code() {
    return code;
  }

  /**
   * 응답 errors — code 가 첫 값이다(웹 handleApiError 는 errors 의 첫 값을 토스트로 쓴다). FULL 이면 scope 를 더한다(Map.of
   * 는 null 을 못 받으므로 순서 있는 맵으로 만든다).
   */
  public Map<String, String> errors() {
    Map<String, String> m = new LinkedHashMap<>();
    m.put("code", code);
    if (scope != null) m.put("scope", scope);
    return m;
  }
}
