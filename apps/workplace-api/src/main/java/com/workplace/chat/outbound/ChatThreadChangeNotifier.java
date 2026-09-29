package com.workplace.chat.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.project.outbound.ProjectAudienceResolver;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 이슈 채팅 스레드의 멤버 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-64). 스레드 멤버 목록은 이슈 화면에 보이므로 프로젝트 멤버
 * 전원에게 보내고, 나간 본인은 커밋 후 명단에서 빠지므로 호출자가 extra 로 넘긴다. payload 에는 projectKey·issueNumber 만 싣는다. 반드시 쓰기
 * 트랜잭션 안에서 호출해야 한다(AFTER_COMMIT).
 */
@Component
@RequiredArgsConstructor
public class ChatThreadChangeNotifier {

  private final ApplicationEventPublisher publisher;

  public void membersChanged(
      long projectId,
      String projectKey,
      int issueNumber,
      long threadId,
      Long actorId,
      Collection<Long> extra) {
    publisher.publishEvent(
        new ResourceChangedEvent(
            "chat-thread",
            ResourceChangedEvent.OP_UPDATED,
            ProjectAudienceResolver.SCOPE,
            projectId,
            List.of(threadId),
            Map.of("projectKey", projectKey, "issueNumber", issueNumber),
            actorId,
            Set.copyOf(extra)));
  }
}
