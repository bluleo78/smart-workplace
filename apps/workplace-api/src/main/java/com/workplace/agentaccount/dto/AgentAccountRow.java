package com.workplace.agentaccount.dto;

import java.time.Instant;

/**
 * AI 계정 목록의 한 행(agent_account, WP-1448). {@code encryptedSecret} 은 'iv:ciphertext' 형태의 암호문이며 평문은
 * 어디에도 두지 않는다. 로그·예외에 암호문이 새지 않도록 {@link #toString()} 에서 뺀다.
 */
public record AgentAccountRow(
    long id,
    String provider,
    String label,
    String encryptedSecret,
    long secretVersion,
    String accountEmail,
    Instant lastRefreshedAt,
    String status,
    Long createdBy,
    Instant createdAt,
    Instant updatedAt,
    Instant revokedAt) {

  /** 암호문({@code encryptedSecret})을 뺀 메타만 문자열로 만든다. */
  @Override
  public String toString() {
    return "AgentAccountRow[id="
        + id
        + ", provider="
        + provider
        + ", label="
        + label
        + ", secretVersion="
        + secretVersion
        + ", accountEmail="
        + accountEmail
        + ", lastRefreshedAt="
        + lastRefreshedAt
        + ", status="
        + status
        + ", createdBy="
        + createdBy
        + ", createdAt="
        + createdAt
        + ", updatedAt="
        + updatedAt
        + ", revokedAt="
        + revokedAt
        + "]";
  }
}
