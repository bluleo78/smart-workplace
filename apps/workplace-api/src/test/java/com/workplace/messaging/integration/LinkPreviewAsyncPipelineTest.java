package com.workplace.messaging.integration;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.MESSAGE_LINK_PREVIEW;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.LinkPreviewResponse;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.FixtureHttpFetcherConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-874: URL 든 메시지 작성 → 커밋 뒤 비동기 가져오기(고정 응답 가져오기) → 미리보기 저장 → {@code
 * messaging.message.link-previews} fan-out 이 {@code messaging.message.created} 뒤에 나가는지. 비-Tx(커밋 필요)
 * — 만든 user 를 추적해 채널(CASCADE)+user 회수.
 */
class LinkPreviewAsyncPipelineTest extends ExternalClientMockedTestBase {

  @Autowired SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  private final List<Long> createdUserIds = new ArrayList<>();

  /** 요청 스레드처럼 활성 테넌트를 세운다 — 커밋 뒤 실행기 제출이 이 값을 워커로 넘긴다(MessagePushDeliveryTest 와 같다). */
  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (createdUserIds.isEmpty()) return;
    dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(createdUserIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
  }

  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "lp_async_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "LpAsync" + suffix)
            .set(USER.EMAIL, "lpasync_" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  @Test
  void create_withUrl_fetchesAsync_storesPreview_andFansOutAfterCreated() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("lp-async-" + UUID.randomUUID(), uid);
    channelService.join(uid, channelId);

    long msgId =
        messageService
            .create(
                uid,
                channelId,
                new CreateMessageRequest("이거 보세요 " + FixtureHttpFetcherConfig.OG_PAGE + "."))
            .id();

    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(5000))
        .fanOut(anyCollection(), eq("messaging.message.link-previews"), payload.capture());
    // 한 스트림에서 created 가 미리보기보다 먼저 — 같은 커밋 뒤 콜백에서 created 를 보낸 다음에 가져오기를 제출한다.
    InOrder order = inOrder(registry);
    order.verify(registry).fanOut(anyCollection(), eq("messaging.message.created"), any());
    order.verify(registry).fanOut(anyCollection(), eq("messaging.message.link-previews"), any());

    List<LinkPreviewResponse> expected =
        List.of(
            new LinkPreviewResponse(
                0, FixtureHttpFetcherConfig.OG_PAGE, "픽스처 제목", null, "픽스처", true));
    assertThat(payload.getValue())
        .isEqualTo(Map.of("channelId", channelId, "id", msgId, "linkPreviews", expected));
    assertThat(dsl.fetchCount(MESSAGE_LINK_PREVIEW, MESSAGE_LINK_PREVIEW.MESSAGE_ID.eq(msgId)))
        .isEqualTo(1);
  }
}
