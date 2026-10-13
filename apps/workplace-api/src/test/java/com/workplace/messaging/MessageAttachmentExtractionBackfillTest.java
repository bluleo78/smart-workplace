package com.workplace.messaging;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentExtractionBackfill;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메시징 첨부 백필 SPI 통합 테스트(WP-358) — 추출 행이 없는 살아 있는 메시지 첨부만 대상이고, 소프트 삭제된 메시지의 첨부는 제외한다. 클래스 트랜잭션 롤백으로
 * 격리.
 */
@Transactional
class MessageAttachmentExtractionBackfillTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessageAttachmentExtractionBackfill source;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;

  /** 유니크 유저 INSERT. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "bf_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Bf" + suffix)
        .set(USER.EMAIL, "bf_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** FILE 행 직접 삽입(디스크 I/O 없음) — 추출 행이 없는 상태. */
  private long seedFile(long uploaderId) {
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "bf.pdf")
        .set(FILE.STORED_NAME, UUID.randomUUID().toString())
        .set(FILE.MIME_TYPE, "application/pdf")
        .set(FILE.SIZE_BYTES, 10L)
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, "/tmp/test/" + UUID.randomUUID())
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, OffsetDateTime.now())
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  private void bind(long fileId, long messageId, long userId) {
    dsl.insertInto(MESSAGE_ATTACHMENT)
        .set(MESSAGE_ATTACHMENT.FILE_ID, fileId)
        .set(MESSAGE_ATTACHMENT.MESSAGE_ID, messageId)
        .set(MESSAGE_ATTACHMENT.ATTACHED_BY, userId)
        .set(MESSAGE_ATTACHMENT.ATTACHED_AT, OffsetDateTime.now())
        .execute();
  }

  @Test
  void 살아_있는_메시지의_첨부는_대상이고_삭제된_메시지의_첨부는_제외() {
    long user = seedUser();
    long channelId = channelRepo.insertPublic("bf-채널", user);
    channelService.join(user, channelId);
    long liveMsg = messageService.create(user, channelId, new CreateMessageRequest("살아 있음")).id();
    long deletedMsg = messageService.create(user, channelId, new CreateMessageRequest("삭제됨")).id();

    long liveFile = seedFile(user);
    long deletedFile = seedFile(user);
    bind(liveFile, liveMsg, user);
    bind(deletedFile, deletedMsg, user);
    messageService.delete(user, deletedMsg);

    assertThat(source.findMissing(100000))
        .extracting(ExtractionBackfillSource.Target::fileId)
        .contains(liveFile)
        .doesNotContain(deletedFile);
  }
}
