package com.workplace.global.tenant;

/**
 * 기본 테넌트(tenant#1) 상수.
 *
 * <p>회원가입(AuthService)이 모든 신규 사용자의 멤버십을 이 테넌트에 만들고 공개 인증 엔드포인트가 이 테넌트 컨텍스트로 동작하므로, 운영자
 * 콘솔(platform)은 이 테넌트의 삭제·영구 삭제를 막는다(WP-341). 여러 모듈이 같은 값을 공유하도록 global 에 둔다. 운영자 콘솔은 상세 응답의 {@code
 * deletable} 플래그로 이 값을 전달받는다(프런트엔드에 id 상수 없음).
 */
public final class DefaultTenant {

  /** 기본 테넌트 id. */
  public static final long ID = 1L;

  private DefaultTenant() {}
}
