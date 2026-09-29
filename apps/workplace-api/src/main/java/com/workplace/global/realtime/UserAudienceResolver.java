package com.workplace.global.realtime;

import java.util.Collection;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * USER scope 수신자 = scopeId 가 가리키는 사용자 한 명 (WP-36). 메일·개인 연락처·알림 읽음·개인 뷰·캘린더처럼 소유자 한 명만 보는 리소스용. 도메인
 * 저장소가 필요 없어 global 에 둔다.
 */
@Component
public class UserAudienceResolver implements AudienceResolver {

  public static final String SCOPE = "USER";

  @Override
  public String scopeType() {
    return SCOPE;
  }

  @Override
  public Collection<Long> resolve(long userId) {
    return List.of(userId);
  }
}
