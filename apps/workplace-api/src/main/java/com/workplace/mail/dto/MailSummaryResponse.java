package com.workplace.mail.dto;

import java.util.List;

/**
 * 홈 위젯용 메일 요약.
 *
 * <ul>
 *   <li>unreadCount — 본인 INBOX 안읽음 수
 *   <li>needsReplyCount — aiNeedsReply=true 이면서 아직 안읽은(seen=false) 수 (#474)
 *   <li>classificationActive — aiEnabled=true 인 활성 계정이 1개 이상 있으면 true (#474)
 *   <li>recent — 최근 안읽은 메일 N건
 * </ul>
 */
public record MailSummaryResponse(
    long unreadCount,
    long needsReplyCount,
    boolean classificationActive,
    List<EmailMessageSummary> recent) {}
