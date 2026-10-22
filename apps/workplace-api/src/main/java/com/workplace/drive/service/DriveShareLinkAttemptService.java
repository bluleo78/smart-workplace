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

  /**
   * 비밀번호를 비교하기 전에 시도 한 칸을 잡는다(WP-783). 동시 요청이 몇 개든 잠금 기간 안에 잡히는 칸은 {@value #MAX_ATTEMPTS} 개뿐이라,
   * 비교까지 가는 추측도 그만큼이다. 비교에 성공하면 {@link #attemptSucceeded} 로 지운다.
   *
   * @return 잡은 뒤의 시도 횟수(1..MAX_ATTEMPTS), 잠겨 있으면 0
   */
  public int tryReserve(String tokenHash) {
    return repository.reserveAttempt(tokenHash, MAX_ATTEMPTS);
  }

  /** 이번 시도로 상한에 닿았는지 — 잠금이 막 걸린 시점(감사 기록용). */
  public boolean reachedLimit(int attempt) {
    return attempt >= MAX_ATTEMPTS;
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
