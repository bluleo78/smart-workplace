package com.workplace.drive.service;

import com.workplace.drive.repository.DriveShareLinkAttemptRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 공유 링크 비밀번호 브루트포스 잠금 정책(#700).
 *
 * <p>{@code LoginAttemptService}(#144)와 동일 정책 — 5회 연속 실패 시 15분 잠금. 카운터는 {@link
 * DriveShareLinkAttemptRepository}를 통해 PostgreSQL에 영속 저장되어 재시작·멀티 인스턴스 환경에서 일관 유지된다. 키는 공유 토큰의
 * SHA-256 hex(token_hash) — 토큰을 아는 공격자 관점의 시도 횟수를 추적한다.
 */
@Service
@RequiredArgsConstructor
public class DriveShareLinkAttemptService {

  private static final int MAX_ATTEMPTS = 5;

  private final DriveShareLinkAttemptRepository repository;

  /** 비밀번호 검증 실패 시 카운터 1 증가. */
  public void attemptFailed(String tokenHash) {
    repository.incrementAttempts(tokenHash);
  }

  /** 비밀번호 검증 성공 시 카운터 제거. */
  public void attemptSucceeded(String tokenHash) {
    repository.clear(tokenHash);
  }

  /** MAX_ATTEMPTS 이상 실패했고 만료 전이면 true. DB 장애 시 예외 전파(fail-closed). */
  public boolean isBlocked(String tokenHash) {
    return repository.getAttempts(tokenHash) >= MAX_ATTEMPTS;
  }
}
