package com.workplace.mail.service;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;

/** 공급자별 단건 본문/첨부 적재(on-demand). 멱등 가드(body_fetched_at 가드는 디스패처가 처리). */
public interface MailBodyLoader {
  /** 이 구현이 담당하는 공급자. {@code MailBodyFetcher} 가 account.provider() 로 디스패치한다. */
  MailProvider provider();

  /**
   * 본문·스니펫·첨부를 공급자에서 읽어 DB 에 캐시한다.
   *
   * @return true: 적재 성공(updateBody 가 실제로 호출됨 — body_fetched_at 설정 완료 또는 의도적 빈 본문). false: 네트워크/파싱
   *     실패로 적재 미완료(body_fetched_at 미설정 — 재시도 가능).
   */
  boolean loadBody(long userId, BodyTarget target, EmailAccountResponse account);
}
