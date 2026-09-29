package com.workplace.wiki.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 위키 스페이스 멤버·첨부 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-64). 수신자는 WIKI_SPACE(스페이스 멤버 전원).
 * payload 에는 id 만 싣는다. 반드시 쓰기 트랜잭션 안에서 호출해야 한다(AFTER_COMMIT).
 */
@Component
@RequiredArgsConstructor
public class WikiChangeNotifier {

  /** 리소스 이름 — 프론트 무효화 맵(resourceInvalidation RULES) 키와 계약 테스트로 일치를 고정한다. */
  public static final String RESOURCE_WIKI_SPACE = "wiki-space";

  public static final String RESOURCE_WIKI_ATTACHMENT = "wiki-attachment";

  private final ApplicationEventPublisher publisher;

  /** 스페이스 멤버 추가·역할 변경·제거. 제거된 멤버는 커밋 후 멤버 조회에서 빠지므로 extraRecipients 로 넘겨 자기 화면에서도 스페이스가 사라지게 한다. */
  public void spaceChanged(long spaceId, long actorId, Collection<Long> removedUserIds) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_WIKI_SPACE,
            ResourceChangedEvent.OP_UPDATED,
            WikiSpaceAudienceResolver.SCOPE,
            spaceId,
            List.of(spaceId),
            Map.of("spaceId", spaceId),
            actorId,
            removedUserIds));
  }

  /** 페이지 첨부 업로드·삭제. */
  public void attachmentChanged(String op, long spaceId, long pageId, long actorId) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_WIKI_ATTACHMENT,
            op,
            WikiSpaceAudienceResolver.SCOPE,
            spaceId,
            List.of(pageId),
            Map.of("spaceId", spaceId, "pageId", pageId),
            actorId));
  }
}
