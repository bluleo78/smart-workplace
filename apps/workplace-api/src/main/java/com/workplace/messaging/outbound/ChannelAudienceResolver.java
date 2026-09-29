package com.workplace.messaging.outbound;

import com.workplace.global.realtime.AudienceResolver;
import com.workplace.messaging.repository.ChannelMemberRepository;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** CHANNEL scope 수신자 = 채널(DM 포함) 멤버 전원 (WP-62). MessageSseDispatcher 와 같은 명단 조회. */
@Component
@RequiredArgsConstructor
public class ChannelAudienceResolver implements AudienceResolver {

  public static final String SCOPE = "CHANNEL";

  private final ChannelMemberRepository memberRepo;

  @Override
  public String scopeType() {
    return SCOPE;
  }

  @Override
  public Collection<Long> resolve(long channelId) {
    return memberRepo.findMemberIds(channelId);
  }
}
