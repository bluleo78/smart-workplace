package com.workplace.home.exception;

import com.workplace.global.exception.CodedException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 공용 AI 메모리 오류(WP-386) — 상태와 코드를 함께 싣는다(GlobalExceptionHandler 가 errors.code 로 내보낸다). 읽기 권한 없는 공간은
 * 존재를 숨기려고 404, 조직 지침을 관리자가 아닌 사람이 쓰면 403.
 */
public class SharedAiMemoryException extends RuntimeException implements CodedException {

  public static final String INVALID = "SHARED_MEMORY_INVALID";
  public static final String SPACE_UNRESOLVED = "SHARED_MEMORY_SPACE_UNRESOLVED";
  public static final String FORBIDDEN = "SHARED_MEMORY_FORBIDDEN";
  public static final String NOT_FOUND = "SHARED_MEMORY_NOT_FOUND";
  public static final String FULL = "SHARED_MEMORY_FULL";
  public static final String CHANGED = "SHARED_MEMORY_CHANGED";
  public static final String CHANGE_UNDONE = "SHARED_MEMORY_CHANGE_UNDONE";
  public static final String PERSONAL = "SHARED_MEMORY_PERSONAL";
  public static final String CHECK_UNAVAILABLE = "SHARED_MEMORY_CHECK_UNAVAILABLE";

  private final HttpStatus status;
  private final String code;

  private SharedAiMemoryException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public static SharedAiMemoryException invalid(String message) {
    return new SharedAiMemoryException(HttpStatus.BAD_REQUEST, INVALID, message);
  }

  /** 요청 도구의 공간을 정하지 못함 — 에이전트가 사용자에게 어느 공간인지 묻는다. */
  public static SharedAiMemoryException spaceUnresolved(String message) {
    return new SharedAiMemoryException(HttpStatus.BAD_REQUEST, SPACE_UNRESOLVED, message);
  }

  public static SharedAiMemoryException forbidden(String message) {
    return new SharedAiMemoryException(HttpStatus.FORBIDDEN, FORBIDDEN, message);
  }

  public static SharedAiMemoryException notFound() {
    return new SharedAiMemoryException(HttpStatus.NOT_FOUND, NOT_FOUND, "공용 메모리를 찾을 수 없어요.");
  }

  public static SharedAiMemoryException full(int limit) {
    return new SharedAiMemoryException(
        HttpStatus.CONFLICT, FULL, "이 공간의 공용 메모리가 가득 찼어요(" + limit + "개). 정리한 뒤 다시 추가해 주세요.");
  }

  public static SharedAiMemoryException changed() {
    return new SharedAiMemoryException(HttpStatus.CONFLICT, CHANGED, "그 뒤에 메모리가 바뀌어 되돌릴 수 없어요.");
  }

  public static SharedAiMemoryException changeUndone() {
    return new SharedAiMemoryException(HttpStatus.CONFLICT, CHANGE_UNDONE, "이미 되돌린 기록이에요.");
  }

  /** 공용성 검사 불통과 — 개인적인 내용이라 공용에 넣지 않는다(에이전트는 개인 메모리로 돌린다). */
  public static SharedAiMemoryException personal() {
    return new SharedAiMemoryException(
        HttpStatus.UNPROCESSABLE_ENTITY, PERSONAL, "개인적인 내용이라 공용 메모리에 넣지 않았어요.");
  }

  /** 공용성 검사를 하지 못함(시간 초과·ai-agent 불가) — 아무것도 저장하지 않는다. */
  public static SharedAiMemoryException checkUnavailable() {
    return new SharedAiMemoryException(
        HttpStatus.SERVICE_UNAVAILABLE, CHECK_UNAVAILABLE, "지금은 공용 메모리에 저장하지 못했어요.");
  }

  @Override
  public HttpStatus status() {
    return status;
  }

  public String code() {
    return code;
  }

  /** 응답 errors — code 하나. */
  @Override
  public Map<String, String> errors() {
    Map<String, String> m = new LinkedHashMap<>();
    m.put("code", code);
    return m;
  }
}
