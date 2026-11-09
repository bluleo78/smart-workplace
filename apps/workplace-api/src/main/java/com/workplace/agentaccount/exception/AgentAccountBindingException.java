package com.workplace.agentaccount.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * AI → 계정 묶기 규칙 위반(WP-1448) — 상태와 사유 코드는 만드는 정적 메서드가 정한다. 메시지는 화면에 그대로 보인다.
 *
 * <ul>
 *   <li>{@code AGENT_ACCOUNT_PERSONAL_ASSISTANT}(400) — 개인 비서는 계정 목록을 쓰지 않는다(주인이 따로 연결한다).
 *   <li>{@code AGENT_ACCOUNT_NOT_POD}(409) — 작업 공간(Pod) 실행 방식이 아닌 AI. 다른 방식은 지금처럼 AI 연결을 쓴다.
 *   <li>{@code AGENT_ACCOUNT_TEMPLATE_MISSING}(409) — 실행 템플릿이 사라져 맞는 계정 종류를 알 수 없다.
 *   <li>{@code AGENT_ACCOUNT_UNFIT}(400) — 실행 템플릿이 요구하는 계정 종류가 아니다.
 *   <li>{@code AGENT_ACCOUNT_NOT_BOUND}(404) — AI 가 묶인 계정이 없다(조회).
 * </ul>
 */
public class AgentAccountBindingException extends RuntimeException implements CodedException {

  private final HttpStatus status;
  private final String code;

  private AgentAccountBindingException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  /** 개인 비서는 계정에 묶지 않는다(400). */
  public static AgentAccountBindingException personalAssistant() {
    return new AgentAccountBindingException(
        HttpStatus.BAD_REQUEST,
        "AGENT_ACCOUNT_PERSONAL_ASSISTANT",
        "개인 비서는 계정 목록의 계정을 쓰지 않아요 — 주인이 내 설정에서 연결해 주세요");
  }

  /** 실행 설정 행이 없는(작업 공간 방식이 아닌) AI(409). */
  public static AgentAccountBindingException notPod() {
    return new AgentAccountBindingException(
        HttpStatus.CONFLICT, "AGENT_ACCOUNT_NOT_POD", "작업 공간 실행 방식 AI 만 계정을 고를 수 있어요");
  }

  /** 실행 템플릿이 사라졌다(409). */
  public static AgentAccountBindingException templateMissing() {
    return new AgentAccountBindingException(
        HttpStatus.CONFLICT,
        "AGENT_ACCOUNT_TEMPLATE_MISSING",
        "이 AI 의 실행 템플릿을 찾을 수 없어요 — 실행 설정을 먼저 고쳐 주세요");
  }

  /** 템플릿이 요구하는 계정 종류가 아니다(400) — 문구는 AI 연결 등록 검사와 같은 것을 받는다. */
  public static AgentAccountBindingException unfit(String message) {
    return new AgentAccountBindingException(HttpStatus.BAD_REQUEST, "AGENT_ACCOUNT_UNFIT", message);
  }

  /** AI 가 묶인 계정이 없다(404). */
  public static AgentAccountBindingException notBound() {
    return new AgentAccountBindingException(
        HttpStatus.NOT_FOUND, "AGENT_ACCOUNT_NOT_BOUND", "이 AI 가 쓰는 계정이 없어요");
  }

  /** 응답 상태. */
  @Override
  public HttpStatus status() {
    return status;
  }

  /** 응답 {@code errors} — 사유 코드 하나. */
  @Override
  public Map<String, String> errors() {
    return Map.of("code", code);
  }
}
