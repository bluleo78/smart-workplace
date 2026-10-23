package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.workplace.global.net.SafeHttpFetcher;
import com.workplace.messaging.controller.LinkPreviewController;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.LinkPreviewResponse;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.exception.MessageAuthorMismatchException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.LinkPreviewRepository;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-874: 링크 미리보기 파이프라인 — 생성 → 가져오기·저장 → 목록 응답 linkPreviews, 보낸 사람만 지우기(지운 뒤 수정해도 재생성 없음), 썸네일 프록시
 * 권한·형식. 외부 사이트 대신 127.0.0.1 로컬 HTTP 서버를 쓰고, 그 호스트만 신뢰하는 가드 인스턴스로 서비스를 조립한다(실제 인터넷 없음). 비동기 리스너는
 * 테스트 프로필에서 꺼져 있어 refresh 를 직접 부른다.
 */
@Transactional
class LinkPreviewServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired LinkPreviewRepository previewRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelPermissions perms;
  @Autowired ApplicationEventPublisher publisher;
  @Autowired PlatformTransactionManager txManager;

  private static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 'I', 'H', 'D', 'R'
  };

  private HttpServer server;
  private String base;
  private SafeHttpFetcher fetcher;
  private LinkPreviewService service;
  private ExecutorService fetchPool;
  private final AtomicInteger flakyHits = new AtomicInteger();
  private final AtomicInteger goneHits = new AtomicInteger();
  private final AtomicInteger imageHits = new AtomicInteger();
  private final AtomicInteger fakeHits = new AtomicInteger();

  @BeforeEach
  void setUp() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(Executors.newFixedThreadPool(6));
    server.createContext(
        "/og",
        ex ->
            send(
                ex,
                "text/html; charset=utf-8",
                ("<html><head><meta property=\"og:title\" content=\"제목 A\">"
                        + "<meta property=\"og:description\" content=\"설명 A\">"
                        + "<meta property=\"og:site_name\" content=\"사이트\">"
                        + "<meta property=\"og:image\" content=\"/img.png\"></head></html>")
                    .getBytes(StandardCharsets.UTF_8)));
    server.createContext(
        "/plain",
        ex ->
            send(
                ex,
                "text/html",
                "<html><head><title>제목 B</title></head></html>".getBytes(StandardCharsets.UTF_8)));
    server.createContext(
        "/svg-page",
        ex ->
            send(
                ex,
                "text/html",
                "<head><title>S</title><meta property=\"og:image\" content=\"/x.svg\"></head>"
                    .getBytes(StandardCharsets.UTF_8)));
    server.createContext(
        "/img.png",
        ex -> {
          imageHits.incrementAndGet();
          send(ex, "image/png", PNG);
        });
    // 첫 요청은 503(일시 장애), 그 뒤로는 정상 — 일시 실패를 캐시하면 두 번째도 미리보기가 없다.
    server.createContext(
        "/flaky",
        ex -> {
          if (flakyHits.incrementAndGet() == 1) {
            ex.sendResponseHeaders(503, -1);
            ex.close();
          } else {
            send(ex, "text/html", "<title>회복</title>".getBytes(StandardCharsets.UTF_8));
          }
        });
    // 제목 없는 페이지 — 확정 결과라 캐시한다.
    server.createContext(
        "/notitle",
        ex -> {
          goneHits.incrementAndGet();
          send(ex, "text/html", "<p>no</p>".getBytes(StandardCharsets.UTF_8));
        });
    // 1초 걸리는 페이지 3개 — 나란히 가져오면 메시지 하나가 약 1초에 끝난다.
    for (String p : List.of("/slow1", "/slow2", "/slow3")) {
      server.createContext(
          p,
          ex -> {
            try {
              Thread.sleep(1000);
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
            }
            send(ex, "text/html", ("<title>" + p + "</title>").getBytes(StandardCharsets.UTF_8));
          });
    }
    server.createContext("/x.svg", ex -> send(ex, "image/svg+xml", "<svg/>".getBytes()));
    // image/png 라고 속인 HTML — 바이트 판정에서 걸러져야 한다.
    server.createContext(
        "/fake-page",
        ex ->
            send(
                ex,
                "text/html",
                "<head><title>F</title><meta property=\"og:image\" content=\"/fake.png\"></head>"
                    .getBytes(StandardCharsets.UTF_8)));
    server.createContext(
        "/fake.png",
        ex -> {
          fakeHits.incrementAndGet();
          send(ex, "image/png", "<html><script>x</script></html>".getBytes());
        });
    server.start();
    base = "http://127.0.0.1:" + server.getAddress().getPort();
    fetcher = new SafeHttpFetcher(InetAddress::getAllByName, Set.of("127.0.0.1"));
    fetchPool = Executors.newFixedThreadPool(3);
    service =
        new LinkPreviewService(
            previewRepo, memberRepo, channelRepo, perms, fetcher, publisher, txManager, fetchPool);
  }

  @AfterEach
  void tearDown() {
    server.stop(0);
    fetcher.close();
    fetchPool.shutdownNow();
  }

  private static void send(HttpExchange ex, String type, byte[] body) throws IOException {
    ex.getResponseHeaders().add("Content-Type", type);
    ex.sendResponseHeaders(200, body.length);
    try (OutputStream os = ex.getResponseBody()) {
      os.write(body);
    }
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "lp_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Lp" + s)
        .set(USER.EMAIL, "lp_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 지금 DB 본문으로 비동기 워커와 같은 인자를 만들어 refresh 를 부른다(테스트 트랜잭션 안이라 커밋 뒤 디스패처는 돌지 않는다). */
  private void refresh(long msgId) {
    String body =
        dsl.select(MESSAGE.BODY).from(MESSAGE).where(MESSAGE.ID.eq(msgId)).fetchOne(MESSAGE.BODY);
    service.refresh(msgId, body, LinkUrlExtractor.extract(body));
  }

  private MessageResponse listed(long caller, long channelId, long messageId) {
    return messageService.list(caller, channelId, null, 50).items().stream()
        .filter(m -> m.id() == messageId)
        .findFirst()
        .orElseThrow();
  }

  @Test
  void create_refresh_storesSuccessfulPreviews_andListReturnsThem() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "lp-" + UUID.randomUUID(), "PUBLIC");
    String body = "보세요 " + base + "/og, " + base + "/missing 그리고 " + base + "/plain.";
    long msgId = messageService.create(owner, ch.id(), new CreateMessageRequest(body)).id();
    // 생성 응답은 아직 비어 있다(가져오기는 커밋 뒤 비동기).
    assertThat(listed(owner, ch.id(), msgId).linkPreviews()).isEmpty();

    refresh(msgId);

    List<LinkPreviewResponse> previews = listed(owner, ch.id(), msgId).linkPreviews();
    // /missing(404)은 저장하지 않는다 — position 은 본문 순서 그대로(0, 2).
    assertThat(previews)
        .containsExactly(
            new LinkPreviewResponse(0, base + "/og", "제목 A", "설명 A", "사이트", true),
            new LinkPreviewResponse(2, base + "/plain", "제목 B", null, null, false));
  }

  @Test
  void edit_removingUrls_clearsPreviews() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "lp-" + UUID.randomUUID(), "PUBLIC");
    long msgId = messageService.create(owner, ch.id(), new CreateMessageRequest(base + "/og")).id();
    refresh(msgId);
    assertThat(previewRepo.findByMessageId(msgId)).hasSize(1);

    messageService.update(owner, msgId, new UpdateMessageRequest("링크 없이 고침"));
    refresh(msgId);
    assertThat(previewRepo.findByMessageId(msgId)).isEmpty();
  }

  @Test
  void dismiss_authorOnly_andNotRegeneratedAfterEdit() {
    long owner = seedUser();
    long member = seedUser();
    long outsider = seedUser();
    ChannelResponse ch = channelService.create(owner, "lp-" + UUID.randomUUID(), "PUBLIC");
    channelService.join(member, ch.id());
    long msgId = messageService.create(owner, ch.id(), new CreateMessageRequest(base + "/og")).id();
    refresh(msgId);

    // 다른 멤버는 403, 비멤버는 존재를 숨기는 404(WP-591).
    assertThatThrownBy(() -> service.dismiss(member, msgId))
        .isInstanceOf(MessageAuthorMismatchException.class);
    assertThatThrownBy(() -> service.dismiss(outsider, msgId))
        .isInstanceOf(MessageNotFoundException.class);
    assertThat(previewRepo.findByMessageId(msgId)).hasSize(1);

    service.dismiss(owner, msgId);
    assertThat(previewRepo.findByMessageId(msgId)).isEmpty();
    assertThat(
            dsl.select(MESSAGE.LINK_PREVIEWS_DISMISSED)
                .from(MESSAGE)
                .where(MESSAGE.ID.eq(msgId))
                .fetchOne(MESSAGE.LINK_PREVIEWS_DISMISSED))
        .isTrue();

    // 지운 뒤 본문을 고쳐도 다시 만들지 않는다.
    messageService.update(owner, msgId, new UpdateMessageRequest("다시 " + base + "/plain"));
    refresh(msgId);
    assertThat(listed(owner, ch.id(), msgId).linkPreviews()).isEmpty();
  }

  @Test
  void image_proxy_memberOnly_rasterOnly_withHeaders() {
    long owner = seedUser();
    long outsider = seedUser();
    ChannelResponse ch = channelService.create(owner, "lp-" + UUID.randomUUID(), "PRIVATE");
    long msgId =
        messageService
            .create(owner, ch.id(), new CreateMessageRequest(base + "/og " + base + "/svg-page"))
            .id();
    refresh(msgId);
    LinkPreviewController controller = new LinkPreviewController(service);

    ResponseEntity<byte[]> ok = controller.image(owner, msgId, 0);
    assertThat(ok.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(ok.getBody()).isEqualTo(PNG);
    assertThat(ok.getHeaders().getContentType()).hasToString("image/png");
    assertThat(ok.getHeaders().getCacheControl()).isEqualTo("max-age=86400, private");

    // 비멤버(비공개 채널)는 404, SVG 썸네일은 거절(404), 없는 position 도 404.
    assertThat(controller.image(outsider, msgId, 0).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(controller.image(owner, msgId, 1).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(controller.image(owner, msgId, 2).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  void transientFailure_notCached_definitiveResult_cached() {
    // 503 → 미리보기 없음, 바로 다시 → 회복한 제목(일시 실패는 캐시하지 않는다)
    assertThat(service.metaFor(base + "/flaky").title()).isNull();
    assertThat(service.metaFor(base + "/flaky").title()).isEqualTo("회복");
    // 제목 없는 페이지는 확정 결과라 두 번째는 외부로 나가지 않는다.
    assertThat(service.metaFor(base + "/notitle").title()).isNull();
    assertThat(service.metaFor(base + "/notitle").title()).isNull();
    assertThat(goneHits.get()).isEqualTo(1);
  }

  @Test
  void refresh_fetchesUrlsInParallel() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "lp-" + UUID.randomUUID(), "PUBLIC");
    long msgId =
        messageService
            .create(
                owner,
                ch.id(),
                new CreateMessageRequest(base + "/slow1 " + base + "/slow2 " + base + "/slow3"))
            .id();
    long start = System.currentTimeMillis();
    refresh(msgId);
    // 순차면 3초 이상 — 나란히면 약 1초.
    assertThat(System.currentTimeMillis() - start).isLessThan(2500);
    assertThat(previewRepo.findByMessageId(msgId)).hasSize(3);
  }

  @Test
  void image_proxy_servesFromServerCache() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "lp-" + UUID.randomUUID(), "PUBLIC");
    long msgId = messageService.create(owner, ch.id(), new CreateMessageRequest(base + "/og")).id();
    refresh(msgId);
    for (int i = 0; i < 5; i++) {
      assertThat(service.fetchImage(owner, msgId, 0)).isPresent();
    }
    assertThat(imageHits.get()).isEqualTo(1);
  }

  @Test
  void image_proxy_rejectsSpoofedContentType_andRemembersPermanentFailure() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "lp-" + UUID.randomUUID(), "PUBLIC");
    long msgId =
        messageService.create(owner, ch.id(), new CreateMessageRequest(base + "/fake-page")).id();
    refresh(msgId);
    // 헤더는 image/png 지만 바이트가 HTML — 404. 확정 실패라 두 번째는 외부로 나가지 않는다.
    assertThat(service.fetchImage(owner, msgId, 0)).isEmpty();
    assertThat(service.fetchImage(owner, msgId, 0)).isEmpty();
    assertThat(fakeHits.get()).isEqualTo(1);
  }
}
