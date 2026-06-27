package com.workplace.global.security;

import java.util.Base64;

/**
 * 테스트 전용 EncryptionService 팩토리. EncryptionService 의 package-private 생성자를 같은 패키지에서 호출해 개발용 더미
 * 키(32바이트 0)로 인스턴스를 만든다. 프로덕션 API(생성자)를 넓히지 않고 cross-package 테스트가 실제 암복호화를 검증할 수 있게 한다.
 */
public final class TestEncryptionFactory {
  private TestEncryptionFactory() {}

  /** 개발용 더미 키(Base64 of 32 zero bytes)로 EncryptionService 를 생성한다. */
  public static EncryptionService withDevKey() {
    return new EncryptionService(Base64.getEncoder().encodeToString(new byte[32]));
  }
}
