package com.workplace.auth.oauth.service;

import com.workplace.global.security.ratelimit.PublicRateLimitFilter;
import com.workplace.global.util.CapabilityTokens;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * OAuth 인가 서버 issuer 와 엔드포인트 주소(WP-1685). issuer 는 공개 웹 주소({@code workplace.public-base-url}, 운영
 * WEB_BASE_URL)를 정규화한 값(끝 '/' 없음)이고, 메타데이터·redirect 의 {@code iss} 에 나가는 모든 주소를 이 값으로만 만든다 — 요청 Host
 * 헤더로 만들면 내부 주소·위조 호스트가 메타데이터에 나갈 수 있다.
 */
@Slf4j
@Component
public class OAuthIssuer {

  private final String issuer;

  public OAuthIssuer(@Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.issuer = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
    if (issuer.isEmpty()) {
      // 운영에서 WEB_BASE_URL 을 빠뜨리면 메타데이터 주소가 상대 경로가 돼 커넥터가 연결하지 못한다 — 기동은 막지 않고 알린다.
      log.warn("workplace.public-base-url 이 비어 있어 OAuth issuer·엔드포인트 주소를 만들 수 없습니다");
    }
  }

  /** issuer — 공개 웹 주소(끝 '/' 없음). */
  public String issuer() {
    return issuer;
  }

  /** 토큰 엔드포인트(API) — 경로는 컨트롤러·속도 제한과 같은 상수. */
  public String tokenEndpoint() {
    return issuer + PublicRateLimitFilter.OAUTH_TOKEN_PATH;
  }

  /** 동적 클라이언트 등록 엔드포인트(API) — 경로는 컨트롤러·속도 제한과 같은 상수. */
  public String registrationEndpoint() {
    return issuer + PublicRateLimitFilter.OAUTH_REGISTER_PATH;
  }

  /** 인가(동의) 엔드포인트 — 웹 화면(WP-1686)이라 /api 가 아니다. */
  public String authorizationEndpoint() {
    return issuer + "/oauth/authorize";
  }
}
