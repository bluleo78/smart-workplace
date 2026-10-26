package com.workplace.chat.service;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 대화에서 삭제한 메시지는 고칠 수 없다(WP-680, 팀 채팅 WP-509 와 같은 규칙). 예전엔 수정 요청이 가려진 본문을 덮어쓰고 edited_at 까지 바꿨다.
 * 다시 지워도 처음 삭제 시각은 그대로 둔다.
 */
@Transactional
class ChatDeletedMessageEditTest extends IntegrationTestBase {

  @Autowired ChatMessageService messageService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;
  @Autowired DSLContext dsl;

  @Test
  void 삭제한_메시지를_수정하면_404_이고_본문은_그대로다() {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    var msg = messageService.create(s.reporterId(), threadId, new CreateChatMessageRequest("원래 글"));
    messageService.delete(s.reporterId(), msg.id());

    assertThatThrownBy(
            () ->
                messageService.update(
                    s.reporterId(), msg.id(), new UpdateChatMessageRequest("덮어쓴 글")))
        .isInstanceOf(ChatMessageNotFoundException.class);

    var row = dsl.selectFrom(CHAT_MESSAGE).where(CHAT_MESSAGE.ID.eq(msg.id())).fetchOne();
    assertThat(row.getBody()).isEqualTo("원래 글");
    assertThat(row.getEditedAt()).isNull();
  }

  @Test
  void 이미_삭제한_메시지를_다시_지워도_처음_삭제_시각을_지킨다() {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    var msg = messageService.create(s.reporterId(), threadId, new CreateChatMessageRequest("글"));
    messageService.delete(s.reporterId(), msg.id());
    // DB(timestamptz)는 마이크로초까지만 저장한다 — 나노초가 붙은 now() 로 비교하면 같은 시각이어도 어긋난다.
    OffsetDateTime first =
        OffsetDateTime.now().minusDays(1).truncatedTo(java.time.temporal.ChronoUnit.MICROS);
    dsl.update(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.DELETED_AT, first)
        .where(CHAT_MESSAGE.ID.eq(msg.id()))
        .execute();

    messageService.delete(s.reporterId(), msg.id());

    var deletedAt =
        dsl.select(CHAT_MESSAGE.DELETED_AT)
            .from(CHAT_MESSAGE)
            .where(CHAT_MESSAGE.ID.eq(msg.id()))
            .fetchOne(CHAT_MESSAGE.DELETED_AT);
    assertThat(deletedAt.toInstant()).isEqualTo(first.toInstant());
  }
}
