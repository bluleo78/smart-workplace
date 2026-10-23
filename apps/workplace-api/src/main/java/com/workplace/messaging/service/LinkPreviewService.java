package com.workplace.messaging.service;

import com.workplace.file.api.ImageSniffer;
import com.workplace.global.net.SafeHttpFetcher;
import com.workplace.global.net.SafeHttpFetcher.FetchException;
import com.workplace.global.net.SafeHttpFetcher.Fetched;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.MessageAuthorMismatchException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.outbound.MessagingDomainEvents.LinkPreviewsChangedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.LinkPreviewRepository;
import com.workplace.messaging.repository.LinkPreviewRepository.MessageState;
import com.workplace.messaging.repository.LinkPreviewRepository.NewPreview;
import com.workplace.messaging.service.OpenGraphParser.OgMeta;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 팀 채팅 링크 미리보기(WP-874) — 본문 URL 의 Open Graph 메타를 서버가 가져와 저장하고, 보낸 사람의 지우기와 썸네일 프록시를 맡는다.
 *
 * <p>가져오기는 DB 커넥션을 쥔 채 하지 않는다: 한 건이 리다이렉트 포함 최대 5초라, 트랜잭션 안에서 기다리면 동시 메시지가 몰릴 때 커넥션 풀이 마른다(WP-751 과
 * 같은 꼴). 그래서 ① 짧은 읽기 트랜잭션으로 본문을 읽고 → ② 트랜잭션 밖에서 가져오고 → ③ 메시지 행을 잠근 저장 트랜잭션에서 본문·수정 시각이 그대로인지, 그 사이
 * 지워지거나 미리보기가 지워지지 않았는지 다시 보고 바꾼다(늦게 끝난 옛 본문 작업이 새 수정을 덮지 않게). 자기 호출로는 {@code @Transactional} 이 걸리지
 * 않아 {@link TransactionTemplate} 으로 경계를 직접 긋는다.
 */
@Slf4j
@Service
public class LinkPreviewService {

  /** HTML 본문 상한 — 메타는 head 에 있으므로 1MB 면 충분하다. */
  static final int MAX_HTML_BYTES = 1024 * 1024;

  /** 썸네일 상한. */
  static final int MAX_IMAGE_BYTES = 2 * 1024 * 1024;

  private static final String HTML_ACCEPT = "text/html;q=1.0, */*;q=0.1";
  private static final String IMAGE_ACCEPT = "image/webp,image/png,image/jpeg,image/gif";

  /** 같은 URL 메타 캐시 유효 시간·최대 건수 — 한 링크를 여러 사람이 연달아 붙여도 외부 사이트를 매번 두드리지 않게. */
  private static final long CACHE_TTL_MS = 10 * 60 * 1000L;

  /** 썸네일 서버 캐시 — 전체 50MB, 성공 1시간, 확정 실패 10분(일시 실패는 담지 않음). */
  private static final long IMAGE_CACHE_BYTES = 50L * 1024 * 1024;

  private static final long IMAGE_TTL_MS = 60 * 60 * 1000L;

  private static final int CACHE_MAX = 1000;

  /** 썸네일 프록시 응답. */
  public record ImageResult(String contentType, byte[] body) {}

  private final LinkPreviewRepository previewRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelRepository channelRepo;
  private final ChannelPermissions perms;
  private final SafeHttpFetcher fetcher;
  private final ApplicationEventPublisher publisher;
  private final TransactionTemplate tx;
  private final TransactionTemplate readTx;
  // 한 메시지의 URL(최대 3개)을 나란히 가져오는 실행기 — 메시지 하나가 가져오기 한 번 시간에 끝나도록.
  private final Executor fetchExecutor;
  private final LinkPreviewImageCache imageCache =
      new LinkPreviewImageCache(
          IMAGE_CACHE_BYTES, IMAGE_TTL_MS, CACHE_TTL_MS, System::currentTimeMillis);

  // URL → (만료 시각, 메타). 확정 결과(메타·제목 없음·4xx·형식 불일치·차단)만 10분 담는다. 일시 실패(타임아웃·5xx·풀 대기 초과)는
  // 담지 않는다 — 잠깐의 장애가 10분 동안 모든 테넌트의 미리보기를 지우지 않게. access-order LRU.
  private final Map<String, CachedMeta> cache =
      new LinkedHashMap<>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, CachedMeta> eldest) {
          return size() > CACHE_MAX;
        }
      };

  private record CachedMeta(long expiresAt, OgMeta meta) {}

  // 같은 URL 을 동시에 가져오려는 요청을 하나로 합친다(여러 메시지가 같은 링크를 거의 동시에 붙인 경우).
  private final ConcurrentHashMap<String, CompletableFuture<OgMeta>> metaInflight =
      new ConcurrentHashMap<>();

  public LinkPreviewService(
      LinkPreviewRepository previewRepo,
      ChannelMemberRepository memberRepo,
      ChannelRepository channelRepo,
      ChannelPermissions perms,
      SafeHttpFetcher fetcher,
      ApplicationEventPublisher publisher,
      PlatformTransactionManager txManager,
      @Qualifier("linkPreviewFetchExecutor") Executor fetchExecutor) {
    this.previewRepo = previewRepo;
    this.memberRepo = memberRepo;
    this.channelRepo = channelRepo;
    this.perms = perms;
    this.fetcher = fetcher;
    this.publisher = publisher;
    this.tx = new TransactionTemplate(txManager);
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
    this.fetchExecutor = fetchExecutor;
  }

  /**
   * 메시지 미리보기를 본문 기준으로 다시 만든다(생성·수정 커밋 뒤 비동기 워커가 부른다). 호출 스레드에 테넌트 컨텍스트가 있어야 한다.
   *
   * <p>body·urls 는 그 커밋의 본문과 거기서 뽑은 URL 이다(추출은 디스패처에서 한 번만). DB 본문이 이미 달라졌으면 더 새 수정의 작업이 따로 돌므로 이
   * 작업은 그만둔다. 지워진 메시지·미리보기를 지운 메시지는 건드리지 않는다. 가져온 것도 기존 행도 없으면 아무것도 하지 않는다(SSE 도 없음).
   */
  public void refresh(long messageId, String body, List<String> urls) {
    record Snapshot(MessageState state, boolean hadRows) {}
    Snapshot snap =
        readTx.execute(
            s ->
                previewRepo
                    .findState(messageId, false)
                    .map(st -> new Snapshot(st, previewRepo.exists(messageId)))
                    .orElse(null));
    if (snap == null || !stillCurrent(snap.state(), body)) return;

    // 트랜잭션 밖에서 나란히 가져온다(최대 3개) — 성공(제목 있음)한 것만 저장. position 은 본문에서 나온 순서.
    List<CompletableFuture<OgMeta>> pending =
        urls.stream()
            .map(u -> CompletableFuture.supplyAsync(() -> metaFor(u), fetchExecutor))
            .toList();
    List<NewPreview> fetched = new ArrayList<>();
    for (int i = 0; i < urls.size(); i++) {
      OgMeta meta = pending.get(i).join();
      if (meta.title() == null) continue;
      fetched.add(
          new NewPreview(
              i, urls.get(i), meta.title(), meta.description(), meta.siteName(), meta.imageUrl()));
    }
    if (fetched.isEmpty() && !snap.hadRows()) return;

    tx.executeWithoutResult(
        s -> {
          MessageState now = previewRepo.findState(messageId, true).orElse(null);
          // 가져오는 사이 본문이 바뀌었거나 지워졌으면 이 결과는 버린다 — 새 수정의 작업이 따로 돈다.
          if (now == null
              || !stillCurrent(now, body)
              || !Objects.equals(now.editedAt(), snap.state().editedAt())) {
            return;
          }
          previewRepo.replace(messageId, fetched);
          publisher.publishEvent(
              new LinkPreviewsChangedEvent(
                  now.channelId(),
                  messageId,
                  fetched.stream().map(NewPreview::toResponse).toList()));
        });
  }

  /** 지워지지 않았고 미리보기도 지우지 않았으며 본문이 이 작업의 본문 그대로인지(null 본문은 빈 문자열과 같게 본다). */
  private static boolean stillCurrent(MessageState st, String body) {
    return !st.deleted()
        && !st.dismissed()
        && Objects.equals(Objects.toString(st.body(), ""), Objects.toString(body, ""));
  }

  /**
   * 보낸 사람이 미리보기를 지운다 — 모두에게서 사라지고 이후 수정해도 다시 생기지 않는다. 볼 수 없는(비멤버)·지워진 메시지는 404(WP-591), 다른 사람 메시지는
   * 403, 보관된 채널은 409(WP-508 — 읽기 전용).
   */
  public void dismiss(long callerId, long messageId) {
    tx.executeWithoutResult(
        s -> {
          MessageState st =
              previewRepo
                  .findState(messageId, true)
                  .orElseThrow(() -> new MessageNotFoundException(messageId));
          if (st.deleted() || !memberRepo.isMember(st.channelId(), callerId)) {
            throw new MessageNotFoundException(messageId);
          }
          if (st.authorId() != callerId) {
            throw new MessageAuthorMismatchException(messageId, callerId);
          }
          if (channelRepo.isArchived(st.channelId())) {
            throw new ChannelArchivedException(st.channelId());
          }
          previewRepo.markDismissed(messageId);
          previewRepo.deleteAll(messageId);
          publisher.publishEvent(
              new LinkPreviewsChangedEvent(st.channelId(), messageId, List.of()));
        });
  }

  /**
   * 썸네일 프록시. 메시지 채널을 읽을 수 있는 사람만(멤버·보관된 공개 채널, WP-621). 권한·행·이미지가 없거나 가져오기에 실패하면 빈 값(컨트롤러가 404).
   * 저장된 image_url 은 외부 페이지가 정한 값이라 가져올 때 같은 SSRF 가드를 다시 거친다.
   */
  public Optional<ImageResult> fetchImage(long callerId, long messageId, int position) {
    String imageUrl =
        readTx.execute(
            s -> {
              MessageState st = previewRepo.findState(messageId, false).orElse(null);
              if (st == null || st.deleted() || !perms.canRead(st.channelId(), callerId)) {
                return null;
              }
              return previewRepo.findImageUrl(messageId, position).orElse(null);
            });
    if (imageUrl == null) return Optional.empty();
    // 권한 확인 뒤 서버 캐시 — 같은 썸네일을 여러 사람이 봐도 외부로는 한 번(동시 요청은 하나로 합침).
    return imageCache.get(imageUrl, this::loadImage);
  }

  /**
   * 썸네일을 가드된 GET 으로 가져온다. 원격 Content-Type 은 믿지 않는다 — 이미지(또는 octet-stream)라고 한 응답만 받고, 실제 바이트를
   * {@link ImageSniffer} 로 판정해(PNG·JPEG·GIF·WebP) 그 형식으로 내보낸다. SVG·HTML 등은 확정 실패.
   */
  private LinkPreviewImageCache.Outcome loadImage(String imageUrl) {
    try {
      Fetched f =
          fetcher.fetch(
              imageUrl,
              IMAGE_ACCEPT,
              m -> m.startsWith("image/") || m.equals("application/octet-stream"),
              MAX_IMAGE_BYTES);
      return ImageSniffer.detect(f.body())
          .map(type -> LinkPreviewImageCache.Outcome.ok(new ImageResult(type, f.body())))
          .orElseGet(() -> LinkPreviewImageCache.Outcome.failed(true));
    } catch (FetchException e) {
      log.debug("[link-preview] 썸네일 가져오기 실패 {}: {}", imageUrl, e.getMessage());
      return LinkPreviewImageCache.Outcome.failed(!e.isTransient());
    }
  }

  /** URL 의 메타 — 확정 결과만 10분 캐시, 같은 URL 동시 요청은 한 번만 가져온다. 가져오기 실패는 title=null. */
  OgMeta metaFor(String url) {
    synchronized (cache) {
      CachedMeta c = cache.get(url);
      if (c != null && System.currentTimeMillis() < c.expiresAt()) return c.meta();
    }
    CompletableFuture<OgMeta> mine = new CompletableFuture<>();
    CompletableFuture<OgMeta> running = metaInflight.putIfAbsent(url, mine);
    if (running != null) return running.join();
    try {
      OgMeta meta = loadMeta(url);
      mine.complete(meta);
      return meta;
    } catch (RuntimeException e) {
      mine.completeExceptionally(e);
      throw e;
    } finally {
      metaInflight.remove(url, mine);
    }
  }

  /** 페이지를 가져와 메타를 뽑고, 확정 결과면 캐시에 담는다. */
  private OgMeta loadMeta(String url) {
    long now = System.currentTimeMillis();
    OgMeta meta;
    boolean cacheable = true;
    try {
      Fetched f = fetcher.fetch(url, HTML_ACCEPT, "text/html"::equals, MAX_HTML_BYTES);
      meta = OpenGraphParser.parse(f.body(), f.charset(), f.finalUri().toString());
    } catch (FetchException e) {
      log.debug("[link-preview] 가져오기 실패 {}: {}", url, e.getMessage());
      meta = new OgMeta(null, null, null, null);
      cacheable = !e.isTransient();
    }
    if (cacheable) {
      synchronized (cache) {
        cache.put(url, new CachedMeta(now + CACHE_TTL_MS, meta));
      }
    }
    return meta;
  }
}
