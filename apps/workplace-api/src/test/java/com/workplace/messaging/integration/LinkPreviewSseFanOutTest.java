package com.workplace.messaging.integration;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.LinkPreviewService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-874: 미리보기 지우기 커밋 뒤 채널 멤버에게 {@code messaging.message.link-previews} 가 {channelId, id,
 * linkPreviews: []} 로 fan-out 되는지. 비-Tx(커밋 필요) — 만든 user 를 추적해 @AfterEach 에서 채널(CASCADE)+user 회수.
 */
class LinkPreviewSseFanOutTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired LinkPreviewService linkPreviewService;
  @Autowired ChannelRepository channelRepo;

  private final List<Long> createdUserIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (createdUserIds.isEmpty()) return;
    dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(createdUserIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
  }

  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "lp_sse_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "LpSse" + suffix)
            .set(USER.EMAIL, "lpsse_" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  @Test
  void dismiss_fansOutEmptyLinkPreviews() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("lp-sse-" + UUID.randomUUID(), uid);
    channelService.join(uid, channelId);
    // URL 은 넣지 않는다 — 테스트 프로필은 비동기 가져오기가 꺼져 있지만, 외부로 나갈 여지를 아예 두지 않는다.
    long msgId = messageService.create(uid, channelId, new CreateMessageRequest("글")).id();

    linkPreviewService.dismiss(uid, msgId);

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000))
        .fanOut(ids.capture(), eq("messaging.message.link-previews"), payload.capture());
    assertThat(ids.getValue()).contains(uid);
    assertThat(payload.getValue())
        .isEqualTo(Map.of("channelId", channelId, "id", msgId, "linkPreviews", List.of()));
  }
}
