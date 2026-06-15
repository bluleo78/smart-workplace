package com.workplace.mail.dto;

import java.util.List;

/** 홈 위젯용 메일 요약 — 안읽음 수 + 최근 안읽은 메일 N건. */
public record MailSummaryResponse(long unreadCount, List<EmailMessageSummary> recent) {}
