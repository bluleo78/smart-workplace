package com.workplace.messaging;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageAttachmentResponse;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageAttachmentRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentStorage;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** MessageAttachmentRepository 통합 테스트 — 바인딩/영구 승격/배치 조회/다운로드 조회 검증. */
@Transactional
class MessageAttachmentRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired MessageAttachmentStorage storage;
  @Autowired MessageAttachmentRepository repo;

  private long userId;
  private long channelId;
  private long messageId;

  /** 테스트 격리를 위해 UUID suffix 유니크 유저 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "att_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Att" + suffix)
        .set(USER.EMAIL, "att_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @BeforeEach
  void setUp() {
    // 유저, 채널, 메시지를 순서대로 시드 (기존 MessageThreadTest / MessageReadTest 패턴 재사용)
    userId = seedUser();
    channelId = channelRepo.insertPublic("attch-채널", userId);
    channelService.join(userId, channelId);
    messageId =
        messageService.create(userId, channelId, new CreateMessageRequest("첨부 테스트 메시지")).id();
  }

  /** findBindable — 임시 파일 존재 시 업로더·미바인딩 상태를 반환해야 한다. */
  @Test
  void findBindable_returnsUploaderAndUnbound() throws Exception {
    var mf = new MockMultipartFile("file", "test.png", "image/png", new byte[] {1, 2, 3});
    Long fileId = storage.storeTemporary(mf, userId);

    var bindable = repo.findBindable(fileId);

    assertThat(bindable).isPresent();
    assertThat(bindable.get().uploadedBy()).isEqualTo(userId);
    assertThat(bindable.get().bound()).isFalse();
  }

  /** bind 후 promoteToPermanent → file.expires_at 이 NULL 이어야 한다(영구 파일로 승격). */
  @Test
  void bind_thenPromote_setsExpiresAtNull() throws Exception {
    var mf = new MockMultipartFile("file", "promote.png", "image/png", new byte[] {4, 5, 6});
    Long fileId = storage.storeTemporary(mf, userId);

    repo.bind(fileId, messageId, userId);
    repo.promoteToPermanent(List.of(fileId));

    var expiresAt =
        dsl.select(FILE.EXPIRES_AT).from(FILE).where(FILE.ID.eq(fileId)).fetchOne(FILE.EXPIRES_AT);
    assertThat(expiresAt).isNull();
  }

  /** bind 후 findByMessageIds → 해당 messageId 에 첨부 1건이 있고 originalName 이 일치해야 한다. */
  @Test
  void findByMessageIds_returnsBatchMap() throws Exception {
    var mf = new MockMultipartFile("file", "batch.pdf", "application/pdf", new byte[] {7, 8});
    Long fileId = storage.storeTemporary(mf, userId);
    repo.bind(fileId, messageId, userId);

    Map<Long, List<MessageAttachmentResponse>> result = repo.findByMessageIds(List.of(messageId));

    assertThat(result).containsKey(messageId);
    assertThat(result.get(messageId)).hasSize(1);
    assertThat(result.get(messageId).get(0).originalName()).isEqualTo("batch.pdf");
  }

  /** bind 후 findBindable → bound == true 이어야 한다. */
  @Test
  void findBindable_afterBind_returnsBound() throws Exception {
    var mf = new MockMultipartFile("file", "bound.png", "image/png", new byte[] {9});
    Long fileId = storage.storeTemporary(mf, userId);
    repo.bind(fileId, messageId, userId);

    var bindable = repo.findBindable(fileId);

    assertThat(bindable).isPresent();
    assertThat(bindable.get().bound()).isTrue();
  }

  /** findStoredFile → 바인딩된 파일의 storagePath 와 mimeType 을 반환해야 한다. */
  @Test
  void findStoredFile_returnsPathAndMime() throws Exception {
    var mf = new MockMultipartFile("file", "stored.png", "image/png", new byte[] {10, 11});
    Long fileId = storage.storeTemporary(mf, userId);
    repo.bind(fileId, messageId, userId);

    var stored = repo.findStoredFile(fileId, messageId);

    assertThat(stored).isPresent();
    assertThat(stored.get().mimeType()).isEqualTo("image/png");
    assertThat(stored.get().path()).isNotBlank();
  }
}
