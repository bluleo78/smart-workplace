package com.workplace.global.security;

/**
 * {@code Authorization: Bearer <토큰>} 헤더에서 토큰을 꺼내는 공용 도우미(WP-1431).
 *
 * <p>RFC 7235 §2.1 — 인증 scheme 은 대소문자를 구분하지 않는다. 그래서 {@code bearer}·{@code BEARER} 도 {@code Bearer}
 * 와 똑같이 받는다. JWT·AI 키(ak_)·PAT(swp_)·runner 토큰(rt_) 필터와 헤더를 직접 읽는 컨트롤러가 모두 이 규칙 하나를 쓰도록 판정을 이곳에
 * 모은다(곳마다 {@code startsWith("Bearer ")} 를 쓰면 한 곳만 고쳐져 어긋난다).
 *
 * <p>허용 범위는 대소문자만 넓힌다 — scheme 뒤 공백은 예전처럼 정확히 하나, 토큰은 다듬지 않는다(탭·여러 공백·토큰 뒤 공백을 받아 주면 인증 입력 형식이 소리
 * 없이 넓어지므로).
 */
public final class BearerTokens {

  /** scheme 과 구분 공백 하나 — 비교는 대소문자 무관. */
  private static final String PREFIX = "Bearer ";

  private BearerTokens() {}

  /**
   * Authorization 헤더 값에서 Bearer 토큰을 꺼낸다.
   *
   * <p>값이 대소문자 무관 {@code "bearer "}(공백 정확히 하나)로 시작하면 그 뒤 나머지를 그대로 토큰으로 돌려준다(앞뒤 공백 제거 안 함 — 공백이 섞인
   * 토큰은 예전처럼 그대로 넘겨 매칭에 실패하게 둔다). 토큰이 비었거나({@code "Bearer "}·{@code "Bearer"}), 다른 scheme({@code
   * Basic …})이거나, scheme 뒤 공백이 없거나({@code Bearerxyz}), null 이면 null — 호출부는 null 이면 "Bearer 인증 아님"
   * 으로 보고 건너뛴다.
   *
   * @param authorizationHeader Authorization 헤더 원문(없으면 null)
   * @return 토큰 문자열, Bearer 토큰이 아니면 null
   */
  public static String extract(String authorizationHeader) {
    if (authorizationHeader == null || authorizationHeader.length() <= PREFIX.length()) {
      return null;
    }
    // scheme 은 대소문자 무관 비교 — regionMatches(ignoreCase) 는 로캘 영향 없이 문자 단위로 비교한다. 구분 공백도 같이 본다.
    if (!authorizationHeader.regionMatches(true, 0, PREFIX, 0, PREFIX.length())) {
      return null;
    }
    return authorizationHeader.substring(PREFIX.length());
  }
}
