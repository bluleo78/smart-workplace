package com.workplace.auth.service;

import com.workplace.auth.repository.LoginAttemptRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 로그인 브루트포스 잠금 정책(#144).
 *
 * <p>5회 연속 실패 시 잠금. 카운터는 {@link LoginAttemptRepository}를 통해 PostgreSQL에 영속 저장되어 재시작·멀티 인스턴스 환경에서 일관
 * 유지된다. 잠금 기간(15분)은 Repository SQL에 인라인되어 있다.
 */
@Service
@RequiredArgsConstructor
public class LoginAttemptService {

  private static final int MAX_ATTEMPTS = 5;

  /** 카운터 키(login_attempts.username) 길이. 아이디는 50자까지라 이보다 긴 이름의 계정은 없다. */
  private static final int MAX_KEY_LENGTH = 255;

  private final LoginAttemptRepository repository;

  /**
   * 로그인 실패 시 카운터 1 증가. 키보다 긴 아이디는 세지 않는다 — 저장이 길이 제약에 걸려 401 대신 409 가 났고(WP-748), 그런 이름의 계정은 없어 잠글
   * 대상도 없다.
   *
   * @return 이 실패로 계정이 잠겼으면(잠금 기준 {@value #MAX_ATTEMPTS}회 이상) true
   */
  public boolean loginFailed(String username) {
    if (username.length() > MAX_KEY_LENGTH) {
      return false;
    }
    // 이 실패로 잠겼는지(WP-1152). 잠긴 동안은 여기까지 오지 않으므로(isBlocked 에서 먼저 거절) 기준 이상이면 이 실패가 잠근 것이다 — 잠금이
    // 풀린 뒤에도 행은 정리 전까지 기준 이상으로 남아 다음 실패가 6·7 로 바로 다시 잠그므로 「같다」로는 두 번째 잠금을 놓친다.
    return repository.incrementAttempts(username) >= MAX_ATTEMPTS;
  }

  /** 로그인 성공 시 카운터 제거. */
  public void loginSucceeded(String username) {
    repository.clear(username);
  }

  /** MAX_ATTEMPTS 이상 실패했고 만료 전이면 true. DB 장애 시 예외 전파(fail-closed). */
  public boolean isBlocked(String username) {
    return repository.getAttempts(username) >= MAX_ATTEMPTS;
  }
}
