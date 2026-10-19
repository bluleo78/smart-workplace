package com.workplace.global.security;

import java.nio.charset.StandardCharsets;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * bcrypt 72바이트 한도를 사용자 말로 드러내는 PasswordEncoder(WP-497). 비밀번호를 저장하는 모든 경로(가입·구성원 추가·비밀번호 변경·드라이브 공유
 * 링크)가 이 빈 하나를 쓰므로 한도 안내를 여기 한 곳에 둔다.
 *
 * <p>encode: 72바이트를 넘으면 {@link PasswordTooLongException}(한국어 400). matches: 저장 해시는 72바이트 이하로만
 * 만들어지므로 더 긴 입력은 예외 대신 불일치(false)로 본다 — 로그인·공유 링크 확인에서 영어 원문 400 이 나지 않게.
 */
public class BcryptLimitPasswordEncoder implements PasswordEncoder {

  /** bcrypt 가 받는 비밀번호 최대 길이(UTF-8 바이트). */
  public static final int MAX_BYTES = 72;

  private final BCryptPasswordEncoder delegate = new BCryptPasswordEncoder();

  @Override
  public String encode(CharSequence rawPassword) {
    if (tooLong(rawPassword)) {
      throw new PasswordTooLongException();
    }
    return delegate.encode(rawPassword);
  }

  @Override
  public boolean matches(CharSequence rawPassword, String encodedPassword) {
    if (tooLong(rawPassword)) {
      return false;
    }
    return delegate.matches(rawPassword, encodedPassword);
  }

  @Override
  public boolean upgradeEncoding(String encodedPassword) {
    return delegate.upgradeEncoding(encodedPassword);
  }

  private static boolean tooLong(CharSequence raw) {
    return raw != null && raw.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES;
  }
}
