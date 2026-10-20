package com.workplace.auth.service;

import com.workplace.auth.exception.AccountLockedException;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * 아이디·비밀번호 자격 검증 — 일반 로그인({@link AuthService})과 운영자 로그인(PlatformAuthService)이 함께 쓴다.
 *
 * <p>WP-623: 실패 응답으로 계정이 있는지 알 수 없게 한다. 없는 아이디·AGENT·비밀번호 없는(SSO 전용) 계정도 모두 같은 문구로 거절하고, 저장된 해시 대신
 * 더미 해시와 비교해 비밀번호 해시 계산 시간을 똑같이 쓴다(전에는 있는 계정 약 0.12초·없는 계정 약 0.02초로 갈렸다).
 */
@Component
public class PasswordLoginVerifier {

  private static final String INVALID = "아이디 또는 비밀번호가 올바르지 않습니다.";

  private final UserRepository userRepository;
  private final PasswordEncoder passwordEncoder;
  private final LoginAttemptService loginAttemptService;

  /** 비교 대상이 없을 때 쓰는 해시 — 실제 해시와 같은 인코더·비용으로 한 번 만들어 둔다. */
  private final String dummyHash;

  public PasswordLoginVerifier(
      UserRepository userRepository,
      PasswordEncoder passwordEncoder,
      LoginAttemptService loginAttemptService) {
    this.userRepository = userRepository;
    this.passwordEncoder = passwordEncoder;
    this.loginAttemptService = loginAttemptService;
    this.dummyHash = passwordEncoder.encode("login-timing-equalizer");
  }

  /**
   * 잠금 확인 후 자격을 검증해 사용자를 돌려준다. 실패는 모두 같은 {@link InvalidCredentialsException}. 비활성 계정 판정은 비밀번호가 맞은 뒤
   * 호출자가 한다(비밀번호를 모르면 알 수 없게).
   */
  public UserResponse verify(String rawUsername, String rawPassword) {
    String username = canonicalUsername(rawUsername);
    if (loginAttemptService.isBlocked(username)) {
      throw new AccountLockedException("로그인 시도 횟수를 초과하였습니다. 잠시 후 다시 시도해 주세요.");
    }
    Optional<UserResponse> user = userRepository.findByUsername(username);
    // AGENT 는 비밀번호 로그인을 쓰지 않는다(키 인증만) — 거절하되 없는 계정과 구별되지 않게 하고, 잠금 카운터는 올리지 않는다.
    boolean agent = user.map(u -> UserKind.isAgent(u.kind())).orElse(false);
    Optional<String> stored =
        user.isPresent() && !agent
            ? userRepository.findPasswordByUsername(username)
            : Optional.empty();
    boolean matches = passwordEncoder.matches(rawPassword, stored.orElse(dummyHash));
    if (user.isEmpty() || agent || stored.isEmpty() || !matches) {
      if (!agent) {
        loginAttemptService.loginFailed(username);
      }
      throw new InvalidCredentialsException(INVALID);
    }
    return user.get();
  }

  /**
   * 입력한 아이디를 저장된 실제 아이디로 맞춘다(WP-624). 휴대폰 키보드가 첫 글자를 대문자로 바꾸거나 앞뒤 공백이 붙어도 같은 계정으로 들어가고, 잠금 카운터도 실제
   * 아이디 하나로 센다(대소문자를 바꿔 가며 잠금을 피하지 못하게). 대소문자만 다른 계정이 둘 이상이면 어느 쪽인지 정할 수 없으니 입력 그대로 둔다 — 정확히 같은
   * 아이디만 맞는다.
   */
  private String canonicalUsername(String rawUsername) {
    String trimmed = rawUsername == null ? "" : rawUsername.strip();
    List<String> matches = userRepository.findUsernamesIgnoreCase(trimmed);
    return matches.size() == 1 ? matches.get(0) : trimmed;
  }
}
