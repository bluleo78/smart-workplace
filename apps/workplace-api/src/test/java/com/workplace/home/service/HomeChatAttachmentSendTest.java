package com.workplace.home.service;

import static com.workplace.jooq.Tables.FILE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.HomeAttachmentTestSupport;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.exception.HomeAttachmentInvalidException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/** WP-234: 전송 시 첨부 연결 — 같은 트랜잭션의 연결·승격·추출 요청, 첨부만 전송, 입력·소유·상한 검증과 동시성. */
class HomeChatAttachmentSendTest extends HomeAttachmentTestSupport {

  private static final String INVALID = "첨부 파일을 사용할 수 없어요. 파일을 다시 올려 주세요.";

  @Test
  void 첨부와_함께_보내면_USER_메시지에_연결되고_영구승격과_추출요청이_된다() throws Exception {
    long uid = user();
    long pdf = upload(uid, "a.pdf", "application/pdf", "%PDF".getBytes());
    long png = upload(uid, "b.png", "image/png", new byte[] {1});
    CountDownLatch latch = stubDone("확인했어요");

    chatService.startChat(uid, null, "요약해 줘", null, List.of(pdf, png));
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    UUID sid = onlySession(uid);
    long userMsgId = sessionService.getMessages(uid, sid).get(0).id();
    assertThat(messageIdOf(pdf)).isEqualTo(userMsgId);
    assertThat(messageIdOf(png)).isEqualTo(userMsgId);
    assertThat(expiresAtOf(pdf)).isNull();
    assertThat(expiresAtOf(png)).isNull();
    assertThat(extraction(pdf)).containsExactly("PENDING", "TEXT_ONLY");
    assertThat(extraction(png)).containsExactly("SKIPPED", "TEXT_ONLY");
    assertThat(sentRequest().query()).isEqualTo("요약해 줘");
  }

  @Test
  void 첨부만_보내면_빈_본문으로_저장하고_제목은_첫_파일명이다() throws Exception {
    long uid = user();
    long pdf = upload(uid, "회의록.pdf", "application/pdf", "%PDF".getBytes());
    CountDownLatch latch = stubDone("읽었어요");

    chatService.startChat(uid, null, "   ", null, List.of(pdf));
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    UUID sid = onlySession(uid);
    assertThat(sessionService.getMessages(uid, sid))
        .filteredOn(m -> "USER".equals(m.role()))
        .extracting(HomeMessageResponse::content)
        .containsExactly("");
    assertThat(sessionService.list(uid, null, 10).items().get(0).title()).isEqualTo("회의록.pdf");
    // ai-agent 에는 정규화된 빈 문자열이 간다(공백만 보내지 않음).
    assertThat(sentRequest().query()).isEqualTo("");
  }

  @Test
  void 쓸_수_없는_fileId_는_같은_문구로_400_이고_새_세션도_만들지_않는다() throws Exception {
    long uid = user();
    long other = user();
    long foreign = upload(other, "x.pdf", "application/pdf", "%PDF".getBytes());
    long expired = upload(uid, "old.pdf", "application/pdf", "%PDF".getBytes());
    inTx(
        () ->
            dsl.update(FILE)
                .set(FILE.EXPIRES_AT, OffsetDateTime.now().minusHours(1))
                .where(FILE.ID.eq(expired))
                .execute());
    // 다른 기능에 붙어 영구가 된 파일 흉내 — 임시가 아니면 홈은 받지 않는다.
    long permanent = upload(uid, "perm.pdf", "application/pdf", "%PDF".getBytes());
    inTx(() -> dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.eq(permanent)).execute());
    UUID used = sessionService.create(uid).id();
    long bound = upload(uid, "b.pdf", "application/pdf", "%PDF".getBytes());
    attachmentService.appendUserMessage(uid, used, "먼저", List.of(bound));
    int before = sessionCount(uid);

    for (long id : new long[] {foreign, expired, permanent, bound, Long.MAX_VALUE}) {
      assertThatThrownBy(() -> chatService.startChat(uid, null, "봐 줘", null, List.of(id)))
          .isInstanceOf(HomeAttachmentInvalidException.class)
          .hasMessage(INVALID);
    }
    assertThat(sessionCount(uid)).isEqualTo(before);
    verify(chatClient, never()).composeStream(any(), any(), any(), any(), any(), any(), any());
  }

  @Test
  void 개수_중복_null_빈_메시지는_400_한국어_사유() {
    long uid = user();
    long f = upload(uid, "a.txt", "text/plain", "x".getBytes());
    List<Long> eleven = new ArrayList<>();
    for (long i = 1; i <= 11; i++) eleven.add(i);

    assertThatThrownBy(() -> chatService.startChat(uid, null, "q", null, eleven))
        .hasMessage("한 번에 첨부할 수 있는 파일은 최대 10개예요.");
    assertThatThrownBy(() -> chatService.startChat(uid, null, "q", null, List.of(f, f)))
        .hasMessage("같은 파일이 두 번 첨부됐어요.");
    assertThatThrownBy(() -> chatService.startChat(uid, null, "q", null, Arrays.asList(f, null)))
        .hasMessage(INVALID);
    assertThatThrownBy(() -> chatService.startChat(uid, null, " ", null, List.of()))
        .isInstanceOf(HomeAttachmentInvalidException.class)
        .hasMessage(HomeAttachmentService.MSG_EMPTY);
    assertThatThrownBy(() -> chatService.startChat(uid, null, null, null, null))
        .hasMessage(HomeAttachmentService.MSG_EMPTY);
    assertThat(sessionCount(uid)).isZero();
    assertThat(expiresAtOf(f)).isNotNull();
  }

  @Test
  void 세션당_30개를_넘기면_400_이고_실패한_전송은_아무것도_남기지_않는다() {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    attachmentService.appendUserMessage(uid, sid, "1", uploadMany(uid, 10));
    attachmentService.appendUserMessage(uid, sid, "2", uploadMany(uid, 10));
    attachmentService.appendUserMessage(uid, sid, "3", uploadMany(uid, 5));
    int messagesBefore = sessionService.getMessages(uid, sid).size();
    List<Long> six = uploadMany(uid, 6);

    assertThatThrownBy(() -> attachmentService.appendUserMessage(uid, sid, "초과", six))
        .isInstanceOf(HomeAttachmentInvalidException.class)
        .hasMessage("이 대화에는 파일을 최대 30개까지 첨부할 수 있어요. 새 대화를 열어 주세요.");
    assertThat(sessionService.getMessages(uid, sid)).hasSize(messagesBefore);
    assertThat(messageIdOf(six.get(0))).isNull();
    assertThat(expiresAtOf(six.get(0))).isNotNull();

    attachmentService.appendUserMessage(uid, sid, "딱 30", six.subList(0, 5));
    assertThat(countInSession(sid)).isEqualTo(30);
  }

  @Test
  void 동시_전송도_세션_상한을_넘지_않는다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    attachmentService.appendUserMessage(uid, sid, "1", uploadMany(uid, 10));
    attachmentService.appendUserMessage(uid, sid, "2", uploadMany(uid, 10));
    attachmentService.appendUserMessage(uid, sid, "3", uploadMany(uid, 5));
    List<Long> a = uploadMany(uid, 5);
    List<Long> b = uploadMany(uid, 5);

    List<Boolean> results = race(() -> send(uid, sid, a), () -> send(uid, sid, b));
    assertThat(results).containsExactlyInAnyOrder(true, false);
    assertThat(countInSession(sid)).isEqualTo(30);
  }

  @Test
  void 같은_파일을_두_세션에_동시에_붙여도_하나만_성공하고_오류는_400_이다() throws Exception {
    long uid = user();
    UUID s1 = sessionService.create(uid).id();
    UUID s2 = sessionService.create(uid).id();
    long f = upload(uid, "a.pdf", "application/pdf", "%PDF".getBytes());

    List<Boolean> results = race(() -> send(uid, s1, List.of(f)), () -> send(uid, s2, List.of(f)));
    assertThat(results).containsExactlyInAnyOrder(true, false);
    assertThat(countInSession(s1) + countInSession(s2)).isEqualTo(1);
  }

  /** 다른 스레드에서 전송 — 성공 true, 400 false. 그 밖의 예외(PK 위반 등)는 그대로 던져 테스트를 실패시킨다. */
  private boolean send(long uid, UUID sid, List<Long> ids) {
    TenantContext.set(1L);
    try {
      attachmentService.appendUserMessage(uid, sid, "동시", ids);
      return true;
    } catch (HomeAttachmentInvalidException e) {
      return false;
    } finally {
      TenantContext.clear();
    }
  }

  /** 두 작업을 같은 출발 신호로 동시에 실행. */
  private List<Boolean> race(Callable<Boolean> x, Callable<Boolean> y) throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      Future<Boolean> fx =
          pool.submit(
              () -> {
                start.await();
                return x.call();
              });
      Future<Boolean> fy =
          pool.submit(
              () -> {
                start.await();
                return y.call();
              });
      start.countDown();
      return List.of(fx.get(15, TimeUnit.SECONDS), fy.get(15, TimeUnit.SECONDS));
    } finally {
      pool.shutdownNow();
      TenantContext.set(1L);
    }
  }
}
