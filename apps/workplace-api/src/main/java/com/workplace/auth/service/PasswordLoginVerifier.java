package com.workplace.auth.service;

import com.workplace.auth.exception.AccountLockedException;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.auth.service.LoginAttemptService.FailureOutcome;
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
    return verify(rawUsername, rawPassword, null);
  }

  /**
   * {@link #verify(String, String)} 에 실패 알림을 더한다(WP-1152). 있는 사람 계정의 로그인이 실패했을 때만 사유와 함께 onFailed 를
   * 부른다 — 없는 아이디·AI 계정·이미 잠긴 계정은 부르지 않는다. 받는 쪽은 응답 시간이 계정 존재로 갈리지 않게 곧바로 돌아와야 한다.
   */
  public UserResponse verify(String rawUsername, String rawPassword, FailedLoginListener onFailed) {
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
        FailureOutcome outcome = loginAttemptService.loginFailed(username);
        // 잠긴 뒤의 실패는 알리지 않는다 — 잠금 확인을 동시에 지나온 요청도 「잠긴 뒤의 시도」다(WP-1161).
        if (onFailed != null && user.isPresent() && outcome != FailureOutcome.AFTER_LOCK) {
          onFailed.failed(user.get(), failureReason(outcome, stored.isEmpty()));
        }
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

  /** 실패 사유 — 잠김이 가장 앞선다(그 실패가 무엇이었든 잠근 실패로 남긴다). */
  private static LoginFailureReason failureReason(FailureOutcome outcome, boolean noPassword) {
    if (outcome == FailureOutcome.LOCKED) return LoginFailureReason.LOCKED;
    return noPassword ? LoginFailureReason.NO_PASSWORD : LoginFailureReason.BAD_PASSWORD;
  }

  /** 있는 사람 계정의 비밀번호 로그인 실패 알림. */
  @FunctionalInterface
  public interface FailedLoginListener {
    void failed(UserResponse user, LoginFailureReason reason);
  }

  /**
   * 비밀번호 로그인 실패 사유(WP-1161). 응답은 모두 같은 문구지만 감사에는 구분해 남긴다 — 비밀번호가 없는(SSO 전용) 계정의 실패를 「비밀번호가 올바르지
   * 않음」으로 남기면, 관리자가 비밀번호를 쓰지 않는 계정이 비밀번호로 두드려지는 것을 알아보지 못한다.
   */
  public enum LoginFailureReason {
    /** 비밀번호가 틀렸다. */
    BAD_PASSWORD,
    /** 비밀번호 로그인을 쓰지 않는(비밀번호가 없는 SSO 전용) 계정이다. */
    NO_PASSWORD,
    /** 이 실패로 계정이 잠겼다. */
    LOCKED
  }
}
