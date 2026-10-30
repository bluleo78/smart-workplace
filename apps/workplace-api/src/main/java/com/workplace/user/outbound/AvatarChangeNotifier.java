package com.workplace.user.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.realtime.UserAudienceResolver;
import com.workplace.tenant.repository.MembershipRepository;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 아바타 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-1226). 다른 사람이 아바타를 바꾸거나 되돌리면 열어 둔 화면(채팅·이슈 등)의
 * 아바타가 새로고침 없이 바뀌게, 웹이 워크스페이스 아바타 목록({@code ['avatars']})을 다시 받도록 알린다.
 *
 * <p>아바타는 테넌트와 무관한 사용자 속성이라(한 사람이 여러 워크스페이스에 속한다) 지금 테넌트만이 아니라 그 사람이 속한 모든 ACTIVE 워크스페이스의 구성원에게 보낸다
 * — USER scope(본인)에 그 구성원 전원을 추가 수신자로 싣는다. 워크스페이스마다 이벤트를 따로 내면 여러 곳에 함께 속한 사람이 같은 알림을 여러 번 받는다.
 * payload 에는 바뀐 사용자 id 만 싣는다. 반드시 쓰기 트랜잭션 안에서 호출해야 한다(AFTER_COMMIT).
 */
@Component
@RequiredArgsConstructor
public class AvatarChangeNotifier {

  /** 리소스 이름 — 프론트 무효화 맵(resourceInvalidation RULES) 키와 계약 테스트로 일치를 고정한다. */
  public static final String RESOURCE_AVATAR = "avatar";

  private final ApplicationEventPublisher publisher;
  private final MembershipRepository membershipRepository;

  /**
   * 사용자 userId 의 아바타가 바뀌었다(op: 바꾸면 updated, 되돌리면 deleted). 수신자는 그 사람과 워크스페이스를 하나라도 함께 쓰는 구성원 전원.
   */
  public void avatarChanged(String op, long userId) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_AVATAR,
            op,
            UserAudienceResolver.SCOPE,
            userId,
            List.of(userId),
            Map.of(),
            null,
            membershipRepository.findActivePeerUserIds(userId)));
  }
}
