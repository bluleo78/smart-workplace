package com.workplace.mail.service;

import com.workplace.mail.outbound.MailAiMessages.IssueRef;
import com.workplace.mail.outbound.MailAiMessages.PriorMail;
import com.workplace.mail.outbound.MailAiMessages.Sender;
import java.util.List;

/**
 * ④ 개인 분석의 보강 입력(WP-150) — 보낸 사람 관계·이전 메일·연결 이슈·첨부 이름. 각 블록은 따로 조회하며 실패한 블록은 null/빈 목록이다.
 *
 * @param sender 관계(조회 실패 시 null)
 * @param thread 같은 스레드 직전 메일(오래된 순, 없거나 실패 시 빈 목록)
 * @param linkedIssue 연결 이슈(없거나 실패 시 null)
 * @param attachments 첨부 이름(없거나 실패 시 빈 목록)
 */
public record PersonalContext(
    Sender sender, List<PriorMail> thread, IssueRef linkedIssue, List<String> attachments) {

  /** 보강 블록 없음. */
  public static final PersonalContext EMPTY = new PersonalContext(null, List.of(), null, List.of());

  public PersonalContext {
    thread = thread == null ? List.of() : List.copyOf(thread);
    attachments = attachments == null ? List.of() : List.copyOf(attachments);
  }
}
