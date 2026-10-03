package com.workplace.mail.dto;

import java.util.List;

/**
 * 홈 위젯용 메일 요약.
 *
 * <ul>
 *   <li>unreadCount — 본인 INBOX 안읽음 수
 *   <li>needsReplyCount — aiNeedsReply=true 이면서 아직 안읽은(seen=false) 수 (#474)
 *   <li>classificationActive — 활성 계정 중 하나라도 분류가 도는(공통 비서 또는 개인 비서 사용+개인 비서) 계정이 있으면 true
 *       (#474, WP-210)
 *   <li>recent — 최근 안읽은 메일 N건
 * </ul>
 */
public record MailSummaryResponse(
    long unreadCount,
    long needsReplyCount,
    boolean classificationActive,
    List<EmailMessageSummary> recent) {}
