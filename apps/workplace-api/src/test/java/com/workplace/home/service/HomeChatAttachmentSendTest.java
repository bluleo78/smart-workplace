package com.workplace.home.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.HomeAttachmentTestSupport;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.exception.HomeAttachmentInvalidException;
import com.workplace.home.exception.HomeSessionNotFoundException;
import com.workplace.home.repository.HomeSessionRepository;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.support.TransactionTemplate;

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

  @Autowired private HomeSessionRepository sessionRepo;

  @Value("${spring.datasource.url}")
  private String dbUrl;

  @Value("${spring.datasource.username}")
  private String dbUser;

  @Value("${spring.datasource.password}")
  private String dbPassword;

  /**
   * 소유 확인은 통과했는데 세션 행 잠금을 기다리는 사이 세션이 지워지면 404 다. 잠금 결과(false)를 무시하고 진행하면 USER 메시지 INSERT 가 FK
   * 위반(500)이 될 수 있다.
   */
  @Test
  void 잠금_대기_중_세션이_삭제되면_404_이고_메시지도_첨부_연결도_남지_않는다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    List<Long> ids = uploadMany(uid, 1);

    assertThat(sendWhileSessionDeleted(uid, sid, ids))
        .isInstanceOf(HomeSessionNotFoundException.class);
    assertThat(messageIdOf(ids.get(0))).isNull();
    assertThat(expiresAtOf(ids.get(0))).isNotNull();
  }

  /** 잠금에서 세션이 없어졌으면 파일 판정까지 가지 않는다 — 쓸 수 없는 파일이어도 400 이 아니라 404(세션 없음이 먼저). */
  @Test
  void 잠금_대기_중_세션이_삭제되면_파일_판정보다_404_가_먼저다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();

    assertThat(sendWhileSessionDeleted(uid, sid, List.of(Long.MAX_VALUE)))
        .isInstanceOf(HomeSessionNotFoundException.class);
  }

  /** 다른 트랜잭션이 세션 행을 잠근 채로 전송을 보내 잠금 대기에 들게 한 뒤, 세션을 지우고 커밋한다. 전송이 던진 예외(성공이면 null)를 돌려준다. */
  private Throwable sendWhileSessionDeleted(long uid, UUID sid, List<Long> ids) throws Exception {
    CountDownLatch locked = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      // 1) 다른 트랜잭션이 세션 행을 먼저 잠그고, 신호를 받으면 세션을 지우고 커밋한다.
      Future<?> holder =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            assertThat(sessionRepo.lockForUpdate(sid)).isTrue();
                            locked.countDown();
                            awaitQuietly(release);
                            dsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.ID.eq(sid)).execute();
                          });
                } finally {
                  TenantContext.clear();
                }
                return null;
              });
      assertThat(locked.await(10, TimeUnit.SECONDS)).isTrue();
      // 2) 전송은 소유 확인을 통과한 뒤 세션 행 잠금에서 기다린다.
      Future<Throwable> sender =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  attachmentService.appendUserMessage(uid, sid, "늦은 전송", ids);
                  return null;
                } catch (Throwable t) {
                  return t;
                } finally {
                  TenantContext.clear();
                }
              });
      awaitLockWaiter(sender);
      // 3) 세션 삭제가 커밋되면 잠금 조회는 행을 찾지 못한다.
      release.countDown();
      holder.get(10, TimeUnit.SECONDS);
      return sender.get(10, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
    }
  }

  /**
   * 전송 커넥션이 행 잠금을 기다리는 상태가 될 때까지 기다린다(최대 10초). 테스트 풀은 2개라(잠금 보유 1 + 전송 1) 풀 밖의 별도 커넥션으로 본다 — 풀에서
   * 빌리면 전송이 커넥션을 못 받아 잠금에 닿지 못한다. pg_stat_activity 는 다른 롤 세션의 대기 상태를 권한으로 가리므로 롤과 무관하게 보이는 pg_locks
   * 를 본다.
   */
  private void awaitLockWaiter(Future<Throwable> sender) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    try (Connection c = DriverManager.getConnection(dbUrl, dbUser, dbPassword);
        PreparedStatement ps =
            c.prepareStatement("select count(*) from pg_locks where not granted")) {
      while (System.nanoTime() < deadline) {
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next() && rs.getLong(1) > 0) return;
        }
        // 잠금에 닿기 전에 끝났으면(소유 확인 실패 등) 기다릴 이유가 없다 — 원인을 그대로 보인다.
        if (sender.isDone()) throw new AssertionError("전송이 잠금 대기 전에 끝났다", sender.get());
        Thread.sleep(20); // 잠금 대기 진입을 관측하는 폴링 간격 — 조건 대기다.
      }
    }
    throw new AssertionError("전송이 세션 행 잠금을 기다리는 상태가 되지 않았다");
  }

  private static void awaitQuietly(CountDownLatch latch) {
    try {
      if (!latch.await(10, TimeUnit.SECONDS)) throw new AssertionError("release 신호가 오지 않았다");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new AssertionError(e);
    }
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
