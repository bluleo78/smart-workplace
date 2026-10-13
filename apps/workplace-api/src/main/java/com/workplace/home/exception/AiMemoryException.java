package com.workplace.home.exception;

import org.springframework.http.HttpStatus;

/**
 * AI 메모리(WP-55) 요청 거절 — HTTP 상태와 사유 코드를 함께 싣는다. 웹·ai-agent 는 {@code errors.code} 로 사유를 가른다(상태만으로는
 * "가득 참"과 "꺼짐"이 같은 409 라 구분되지 않는다).
 */
public class AiMemoryException extends RuntimeException {

  public static final String INVALID = "AI_MEMORY_INVALID";
  public static final String NOT_FOUND = "AI_MEMORY_NOT_FOUND";
  public static final String FULL = "AI_MEMORY_FULL";
  public static final String DISABLED = "AI_MEMORY_DISABLED";
  public static final String GONE = "AI_MEMORY_GONE";

  private final HttpStatus status;
  private final String code;

  private AiMemoryException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  /** 길이·종류·빈 값 등 입력 오류(400). 잘라서 저장하지 않는다 — 뜻이 바뀌므로. */
  public static AiMemoryException invalid(String message) {
    return new AiMemoryException(HttpStatus.BAD_REQUEST, INVALID, message);
  }

  /** 없거나 다른 사용자의 메모리·메시지(404) — 존재를 드러내지 않는다. */
  public static AiMemoryException notFound() {
    return new AiMemoryException(HttpStatus.NOT_FOUND, NOT_FOUND, "메모리를 찾을 수 없어요");
  }

  /** 사용자당 상한(50개) 초과(409). 조용히 버리지 않는다. */
  public static AiMemoryException full() {
    return new AiMemoryException(
        HttpStatus.CONFLICT, FULL, "메모리가 가득 찼어요(최대 50개). 필요 없는 항목을 지워 주세요");
  }

  /** 메모리를 끈 사용자에 대한 AI 대행 쓰기(409). 설정 화면 직접 관리는 허용된다. */
  public static AiMemoryException disabled() {
    return new AiMemoryException(HttpStatus.CONFLICT, DISABLED, "사용자가 메모리를 꺼 두었어요. 메모리 도구를 쓰지 마세요");
  }

  /** 되돌릴 대상(고친 메모리)이 이미 지워졌다(404). */
  public static AiMemoryException gone() {
    return new AiMemoryException(HttpStatus.NOT_FOUND, GONE, "이미 지워진 메모리예요");
  }

  /** 응답에 쓸 HTTP 상태. */
  public HttpStatus status() {
    return status;
  }

  /** errors.code 로 싣는 사유 코드(AI_MEMORY_*). */
  public String code() {
    return code;
  }
}
