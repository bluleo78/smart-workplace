package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * #859 이미 이슈로 전환한 메일을 다시 전환하려 함 → 409. 메시지에 기존 이슈 키를 담아 호출자(웹·AI 도구)가 새로 만들지 않고 기존 이슈로 안내할 수 있게 한다.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class MailAlreadyPromotedException extends RuntimeException {
  private final String issueKey;

  public MailAlreadyPromotedException(String issueKey) {
    super("이미 이 메일로 만든 이슈가 있습니다: " + issueKey);
    this.issueKey = issueKey;
  }

  public String issueKey() {
    return issueKey;
  }
}
