package com.workplace.wiki.outbound;

import com.workplace.global.realtime.AudienceResolver;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** WIKI_SPACE scope 수신자 = 위키 스페이스 멤버 전원 (WP-64). WikiSseDispatcher 와 같은 명단 조회. */
@Component
@RequiredArgsConstructor
public class WikiSpaceAudienceResolver implements AudienceResolver {

  public static final String SCOPE = "WIKI_SPACE";

  private final WikiSpaceMemberRepository members;

  @Override
  public String scopeType() {
    return SCOPE;
  }

  @Override
  public Collection<Long> resolve(long spaceId) {
    return members.memberUserIds(spaceId);
  }
}
