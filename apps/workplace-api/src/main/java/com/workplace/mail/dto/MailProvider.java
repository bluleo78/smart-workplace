package com.workplace.mail.dto;

/** 메일 계정 공급자. IMAP=호스트/포트/비밀번호 기반, M365_GRAPH=Microsoft Graph OAuth2 위임. */
public enum MailProvider {
  IMAP,
  M365_GRAPH
}
