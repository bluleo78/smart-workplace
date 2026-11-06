package com.workplace.drive;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.drive.exception.DriveQuotaExceededException;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.service.HomeAttachmentService;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 첨부 업로드의 저장 공간 한도 검사(WP-1391) — 이슈 첨부·이슈챗·채팅·홈 첨부도 사용량에 들어가므로, 한도를 넘는 업로드는 저장 전에 {@link
 * DriveQuotaExceededException}(409, 드라이브 업로드와 같은 문구)으로 막히고 file 행이 남지 않는다. 한도 안이면 그대로 올라간다.
 *
 * <p>한도는 테스트 시작 시점 사용량 + 2 바이트로 둔다 — 공유 테스트 DB 의 잔여 행과 무관하게 3 바이트는 넘치고 2 바이트는 들어간다. 테넌트#1 테스트 트랜잭션
 * 안에서 돌고 롤백된다(한도 변경도 함께 되돌아간다).
 */
@Transactional
class AttachmentUploadQuotaTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveQuotaService quotaService;
  @Autowired ChatFixtures fx;
  @Autowired ChatThreadService threadService;
  @Autowired IssueAttachmentService issueAttachments;
  @Autowired ChatMessageAttachmentService chatAttachments;
  @Autowired MessageAttachmentService messageAttachments;
  @Autowired HomeAttachmentService homeAttachments;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;

  /** FilePathBuilder·RLS 가 테넌트#1 을 쓰도록. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 한도를 「지금 사용량 + 2」로 — 3 바이트 업로드는 넘치고 2 바이트는 정확히 들어간다. */
  private void leaveRoomForTwoBytes() {
    long used = quotaService.usedBytes();
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, used + 2).where(TENANT.ID.eq(1L)).execute();
  }

  private static MultipartFile bytes(int n) {
    return new MockMultipartFile("files", "a.txt", "text/plain", new byte[n]);
  }

  /** 이 사용자가 올린 file 행 수 — 거절된 업로드가 행을 남기지 않았는지 본다. */
  private int filesUploadedBy(long userId) {
    return dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(userId));
  }

  @Test
  void 이슈_첨부_업로드는_한도를_넘으면_저장_전에_거절된다() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    leaveRoomForTwoBytes();

    assertThatThrownBy(
            () ->
                issueAttachments.upload(
                    s.reporterId(), s.projectKey(), s.issueNumber(), List.of(bytes(3))))
        .isInstanceOf(DriveQuotaExceededException.class)
        .hasMessageStartingWith("저장 용량을 초과했습니다");
    assertThat(filesUploadedBy(s.reporterId())).isZero();

    // 한도 안이면 그대로 올라간다.
    assertThat(
            issueAttachments.upload(
                s.reporterId(), s.projectKey(), s.issueNumber(), List.of(bytes(2))))
        .hasSize(1);
  }

  @Test
  void 이슈챗_첨부_업로드는_한도를_넘으면_저장_전에_거절된다() throws Exception {
    ChatFixtures.Setup s = fx.setup();
    long threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
    leaveRoomForTwoBytes();

    // 여러 파일이면 합계로 판정한다 — 하나씩(1·2)은 들어가지만 합계 3 은 넘친다.
    assertThatThrownBy(
            () -> chatAttachments.upload(s.reporterId(), threadId, List.of(bytes(1), bytes(2))))
        .isInstanceOf(DriveQuotaExceededException.class);
    assertThat(filesUploadedBy(s.reporterId())).isZero();

    assertThat(chatAttachments.upload(s.reporterId(), threadId, List.of(bytes(2)))).hasSize(1);
  }

  @Test
  void 채팅_첨부_업로드는_한도를_넘으면_저장_전에_거절된다() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long channelId = channelRepo.insertPublic("quota-" + user, user);
    channelService.join(user, channelId);
    leaveRoomForTwoBytes();

    assertThatThrownBy(() -> messageAttachments.upload(user, channelId, List.of(bytes(3))))
        .isInstanceOf(DriveQuotaExceededException.class);
    assertThat(filesUploadedBy(user)).isZero();

    assertThat(messageAttachments.upload(user, channelId, List.of(bytes(2)))).hasSize(1);
  }

  @Test
  void 홈_첨부_업로드는_한도를_넘으면_저장_전에_거절된다() {
    long user = TestFixtures.createHuman(dsl);
    leaveRoomForTwoBytes();

    assertThatThrownBy(() -> homeAttachments.upload(user, List.of(bytes(3))))
        .isInstanceOf(DriveQuotaExceededException.class);
    assertThat(filesUploadedBy(user)).isZero();

    assertThat(homeAttachments.upload(user, List.of(bytes(2)))).hasSize(1);
  }
}
