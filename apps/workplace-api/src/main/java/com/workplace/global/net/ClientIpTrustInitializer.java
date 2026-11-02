package com.workplace.global.net;

import com.workplace.global.util.ClientIpExtractor;
import org.springframework.stereotype.Component;

/**
 * 기동 때 믿는 프록시 대역 설정({@link ClientIpProperties})을 {@link ClientIpExtractor} 에 넣는다(WP-1317). 판정은 요청
 * 밖의 정적 호출({@code RequestInfo.current()})에서도 쓰여 빈 대신 정적 설정으로 둔다. 잘못된 CIDR 이면 기동이 실패한다.
 */
@Component
public class ClientIpTrustInitializer {

  public ClientIpTrustInitializer(ClientIpProperties properties) {
    ClientIpExtractor.trustProxies(properties.trustedProxies());
  }
}
