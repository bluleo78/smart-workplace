package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 보고 요청에 X-Agent-Tool 헤더(수행 도구)가 없다 → 400. */
@ResponseStatus(HttpStatus.BAD_REQUEST)
public class AgentToolRequiredException extends RuntimeException {
  public AgentToolRequiredException() {
    super("X-Agent-Tool header is required");
  }
}
