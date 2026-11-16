package com.workplace.issue.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * AI 연동이 꺼져 있어(workplace.ai-agent.enabled=false) 사람이 누른 AI 요청을 받을 수 없다(WP-1640) — 409 + {@code
 * errors.code=AI_DISABLED}. 설정 상태라 ai-agent 오류(502)와 가른다. 보고 생성(WP-1639)의 AI_DISABLED 와 같은 코드다.
 */
public class IssueAiDisabledException extends RuntimeException implements CodedException {

  /** 사유 코드. */
  public static final String CODE = "AI_DISABLED";

  /**
   * @param message 화면에 그대로 보일 문구(기능마다 다르다)
   */
  public IssueAiDisabledException(String message) {
    super(message);
  }

  @Override
  public HttpStatus status() {
    return HttpStatus.CONFLICT;
  }

  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
