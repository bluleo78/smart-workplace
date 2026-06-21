// MessageDriveLinkSourceResolverTest.java — MESSAGE resolver + provider 통합 테스트
package com.workplace.drive;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentSourceProvider;
import com.workplace.messaging.service.MessageDriveLinkSourceResolver;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * MessageDriveLinkSourceResolver + MessageAttachmentSourceProvider 통합 테스트. 채널멤버=accessible=true;
 * 비멤버=accessible=false(맵에 포함); q 필터; beforeAt 커서.
 */
@Transactional
class MessageDriveLinkSourceResolverTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessageDriveLinkSourceResolver msgResolver;
  @Autowired MessageAttachmentSourceProvider msgProvider;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;

  /** 테스트 격리용 유니크 유저 INSERT. */
  private long seedUser(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix + suffix)
            .set(USER.EMAIL, prefix + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** FILE 행 직접 삽입 (디스크 I/O 없음). */
  private long seedFile(long uploaderId, String name, String mime) {
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, name)
        .set(FILE.STORED_NAME, UUID.randomUUID().toString())
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, 200L)
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, "/tmp/test/" + UUID.randomUUID())
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, OffsetDateTime.now())
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** MESSAGE_ATTACHMENT 행 직접 삽입. */
  private void bindAttachment(long fileId, long messageId, long userId, OffsetDateTime at) {
    dsl.insertInto(MESSAGE_ATTACHMENT)
        .set(MESSAGE_ATTACHMENT.FILE_ID, fileId)
        .set(MESSAGE_ATTACHMENT.MESSAGE_ID, messageId)
        .set(MESSAGE_ATTACHMENT.ATTACHED_BY, userId)
        .set(MESSAGE_ATTACHMENT.ATTACHED_AT, at)
        .execute();
  }

  // ── Resolver 테스트 ───────────────────────────────────────────────

  /** 채널 멤버는 accessible=true + 라벨/딥링크; 비멤버는 accessible=false(맵에 포함). */
  @Test
  void resolve_returnsLabelAndAccess_forMemberAndStranger() {
    long member = seedUser("mem");
    long stranger = seedUser("str");

    long channelId = channelRepo.insertPublic("테스트채널", member);
    channelService.join(member, channelId);

    var msg = messageService.create(member, channelId, new CreateMessageRequest("안녕하세요 테스트"));

    // 멤버 → accessible=true + 라벨/딥링크 확인
    var memberMap = msgResolver.resolve(member, List.of(msg.id()));
    assertThat(memberMap).containsKey(msg.id());
    var resolved = memberMap.get(msg.id());
    assertThat(resolved.accessible()).isTrue();
    assertThat(resolved.label()).contains("테스트채널").contains("안녕하세요");
    assertThat(resolved.deepLink()).isEqualTo("/chat/channels/" + channelId);

    // 비멤버 → 맵에 포함되지만 accessible=false
    var strangerMap = msgResolver.resolve(stranger, List.of(msg.id()));
    assertThat(strangerMap).containsKey(msg.id());
    assertThat(strangerMap.get(msg.id()).accessible()).isFalse();
  }

  /** 존재하지 않는 messageId 는 결과 맵에서 제외. */
  @Test
  void resolve_excludesNonExistentMessage() {
    long user = seedUser("u1");
    var map = msgResolver.resolve(user, List.of(999_999_998L));
    assertThat(map).doesNotContainKey(999_999_998L);
  }

  // ── Provider 테스트 ───────────────────────────────────────────────

  /** 내 채널 첨부만 노출; 비멤버 채널 첨부는 제외. */
  @Test
  void provider_list_showsMemberChannelAttachmentsOnly() {
    long myUser = seedUser("myU");
    long otherUser = seedUser("otherU");

    long myChannelId = channelRepo.insertPublic("내채널", myUser);
    channelService.join(myUser, myChannelId);

    long otherChannelId = channelRepo.insertPublic("남의채널", otherUser);
    channelService.join(otherUser, otherChannelId);

    var myMsg = messageService.create(myUser, myChannelId, new CreateMessageRequest("내 메시지"));
    var otherMsg =
        messageService.create(otherUser, otherChannelId, new CreateMessageRequest("남의 메시지"));

    long myFileId = seedFile(myUser, "my-file.pdf", "application/pdf");
    long otherFileId = seedFile(otherUser, "other-file.pdf", "application/pdf");

    OffsetDateTime now = OffsetDateTime.now();
    bindAttachment(myFileId, myMsg.id(), myUser, now);
    bindAttachment(otherFileId, otherMsg.id(), otherUser, now);

    var entries = msgProvider.list(myUser, null, null, 10);

    assertThat(entries).anyMatch(e -> e.fileId() == myFileId);
    assertThat(entries).noneMatch(e -> e.fileId() == otherFileId);
  }

  /** q 필터: 파일명 부분일치. */
  @Test
  void provider_list_filtersByName() {
    long user = seedUser("qfilt");

    long channelId = channelRepo.insertPublic("q필터채널", user);
    channelService.join(user, channelId);

    var msg = messageService.create(user, channelId, new CreateMessageRequest("hello"));

    long fA = seedFile(user, "slide_deck.pptx", "application/vnd.openxmlformats");
    long fB = seedFile(user, "photo.jpg", "image/jpeg");

    OffsetDateTime now = OffsetDateTime.now();
    bindAttachment(fA, msg.id(), user, now.minusSeconds(2));
    bindAttachment(fB, msg.id(), user, now.minusSeconds(1));

    var filtered = msgProvider.list(user, "slide", null, 10);
    assertThat(filtered).anyMatch(e -> e.fileId() == fA);
    assertThat(filtered).noneMatch(e -> e.fileId() == fB);
  }

  /** beforeAt 커서: 특정 시각 이전 첨부만 반환. */
  @Test
  void provider_list_cursorPagination() {
    long user = seedUser("cur");

    long channelId = channelRepo.insertPublic("커서채널", user);
    channelService.join(user, channelId);

    var msg = messageService.create(user, channelId, new CreateMessageRequest("cursor test"));

    OffsetDateTime t1 = OffsetDateTime.now().minusSeconds(10);
    OffsetDateTime t2 = OffsetDateTime.now().minusSeconds(5);
    OffsetDateTime t3 = OffsetDateTime.now().minusSeconds(1);

    long f1 = seedFile(user, "old.txt", "text/plain");
    long f2 = seedFile(user, "mid.txt", "text/plain");
    long f3 = seedFile(user, "new.txt", "text/plain");

    bindAttachment(f1, msg.id(), user, t1);
    bindAttachment(f2, msg.id(), user, t2);
    bindAttachment(f3, msg.id(), user, t3);

    // t2 이전 → f1 만
    var page = msgProvider.list(user, null, t2.toInstant(), 10);
    assertThat(page).anyMatch(e -> e.fileId() == f1);
    assertThat(page).noneMatch(e -> e.fileId() == f2);
    assertThat(page).noneMatch(e -> e.fileId() == f3);
  }

  /** 결과는 attachedAt 내림차순 정렬. */
  @Test
  void provider_list_orderedByAttachedAtDesc() {
    long user = seedUser("ord");

    long channelId = channelRepo.insertPublic("정렬채널", user);
    channelService.join(user, channelId);

    var msg = messageService.create(user, channelId, new CreateMessageRequest("order test"));

    OffsetDateTime older = OffsetDateTime.now().minusSeconds(10);
    OffsetDateTime newer = OffsetDateTime.now().minusSeconds(1);

    long fOld = seedFile(user, "old.txt", "text/plain");
    long fNew = seedFile(user, "new.txt", "text/plain");

    bindAttachment(fOld, msg.id(), user, older);
    bindAttachment(fNew, msg.id(), user, newer);

    var entries = msgProvider.list(user, null, null, 10);
    // newer 가 먼저
    long firstId =
        entries.stream()
            .filter(e -> e.fileId() == fNew || e.fileId() == fOld)
            .findFirst()
            .map(e -> e.fileId())
            .orElse(-1L);
    assertThat(firstId).isEqualTo(fNew);
  }

  /**
   * downloadUrl 형식 검증:
   * /api/v1/messaging/channels/{id}/messages/{msgId}/attachments/{fileId}/content
   */
  @Test
  void provider_list_downloadUrlFormat() {
    long user = seedUser("dlurl");

    long channelId = channelRepo.insertPublic("다운로드URL채널", user);
    channelService.join(user, channelId);

    var msg = messageService.create(user, channelId, new CreateMessageRequest("dl url test"));

    long fId = seedFile(user, "doc.pdf", "application/pdf");
    bindAttachment(fId, msg.id(), user, OffsetDateTime.now());

    var entries = msgProvider.list(user, null, null, 10);
    var entry = entries.stream().filter(e -> e.fileId() == fId).findFirst().orElseThrow();

    assertThat(entry.downloadUrl())
        .isEqualTo(
            "/api/v1/messaging/channels/"
                + channelId
                + "/messages/"
                + msg.id()
                + "/attachments/"
                + fId
                + "/content");
  }
}
