package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 이슈 요약에 쓸 AI 비서(토큰 보유)가 없을 때. 사용자 요청(버튼) 경로에서 친절한 4xx 로 매핑. */
@ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
public class IssueAiAssistantUnavailableException extends RuntimeException {
  public IssueAiAssistantUnavailableException() {
    super("AI 비서가 설정되지 않아 요약을 생성할 수 없어요. 관리자에게 문의해주세요.");
  }
}
