package com.workplace.messaging.outbound;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.service.LinkPreviewService;
import com.workplace.messaging.service.LinkUrlExtractor;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 메시지 생성·수정 커밋 뒤 링크 미리보기 가져오기를 linkPreviewExecutor 에 넘긴다(WP-874). 사람·AI(AGENT)·제안 카드 등
 * MessageCreatedEvent·MessageUpdatedEvent 를 내는 모든 작성 경로가 대상이다.
 *
 * <p>이벤트 리스너가 아니라 {@link MessageSseDispatcher} 가 커밋 뒤 콜백 안에서 created/updated SSE 를 보낸 <b>바로 다음</b>에
 * 부른다 — 그래야 한 SSE 스트림에서 {@code messaging.message.created}(또는 updated)가 늘 {@code
 * messaging.message.link-previews} 보다 먼저 나간다(별도 리스너면 두 커밋 뒤 작업의 순서가 보장되지 않아 미리보기가 메시지보다 먼저 도착할 수
 * 있었다). 실행기의 TenantContextTaskDecorator 가 제출 시점(요청 스레드)의 테넌트를 워커로 복원한다.
 *
 * <p>우리 앱의 이슈·노트·파일 주소(공개 웹 주소 {@code workplace.public-base-url} 와 호스트가 같고 경로가 그 화면인 URL)는 가져오지
 * 않는다(WP-896) — 웹이 보는 사람 권한으로 앱 카드를 따로 그린다. 가져오면 SPA 껍데기의 같은 제목 카드가 함께 붙는다. 같은 호스트라도 카드가 없는 경로(공개
 * 노트 공유 링크 등 — 자기 OG 메타가 있다)는 지금처럼 가져온다. 경로 규칙은 웹 {@code src/lib/appLinks.ts} 와 같아야 한다.
 */
@Slf4j
@Component
public class LinkPreviewDispatcher {

  private final LinkPreviewService service;
  private final Executor executor;
  // 우리 앱의 호스트(소문자). 설정이 비었거나 읽을 수 없으면 null — 아무 URL 도 빼지 않는다.
  private final String appHost;

  public LinkPreviewDispatcher(
      LinkPreviewService service,
      @Qualifier("linkPreviewExecutor") Executor executor,
      @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.service = service;
    this.executor = executor;
    this.appHost = hostOf(publicBaseUrl);
  }

  /** 새 메시지 — 본문에 (앱 밖) URL 이 없으면 제출하지 않는다(만들 것도, 지울 것도 없다). */
  void afterCreated(long messageId, String body) {
    List<String> urls = externalUrls(body);
    if (!urls.isEmpty()) submit(messageId, body, urls);
  }

  /** 본문 수정 — URL 이 빠졌으면 기존 미리보기를 지워야 하므로 늘 제출한다. */
  void afterUpdated(long messageId, String body) {
    submit(messageId, body, externalUrls(body));
  }

  /**
   * 미리보기를 가져올 URL — 본문 앞 {@link LinkUrlExtractor#MAX_PREVIEWS} 개 중 앱 카드 주소를 뺀 것. 앱 링크도 3개 몫을
   * 차지한다(웹이 같은 3개 안에서 앱 카드를 그려 한 메시지 카드 수가 늘 3개 이하).
   */
  List<String> externalUrls(String body) {
    List<String> urls = LinkUrlExtractor.extract(body);
    if (appHost == null) return urls;
    return urls.stream().filter(u -> !isAppCardUrl(u)).toList();
  }

  // scheme://host[:port][path][?query][#fragment] — URI.create 는 추출기가 받는 [ ] 등에서 실패해 직접 나눈다.
  private static final Pattern URL_PARTS =
      Pattern.compile(
          "^https?://([^/?#:]+)(?::\\d*)?([^?#]*)(?:\\?([^#]*))?.*$", Pattern.CASE_INSENSITIVE);
  private static final Pattern ID = Pattern.compile("[1-9][0-9]{0,17}");
  private static final Pattern PROJECT_KEY = Pattern.compile("[A-Za-z][A-Za-z0-9]{1,9}");
  private static final Pattern FILE_PARAM = Pattern.compile("(?:^|&)file=([^&]*)");

  /**
   * 웹이 앱 카드로 그리는 주소인지 — 호스트가 우리 앱이고 경로가 {@code /projects/{KEY}/issues/{n}}·{@code
   * /wiki/spaces/{s}/pages/{id}}·{@code /wiki/open/{id}}·{@code /drive/spaces/{s}?file={id}} 중 하나.
   */
  boolean isAppCardUrl(String url) {
    Matcher m = URL_PARTS.matcher(url);
    if (!m.matches() || !m.group(1).toLowerCase(Locale.ROOT).equals(appHost)) return false;
    String[] p =
        Arrays.stream(m.group(2).split("/")).filter(x -> !x.isEmpty()).toArray(String[]::new);
    if (p.length == 4 && p[0].equals("projects") && p[2].equals("issues")) {
      return PROJECT_KEY.matcher(p[1]).matches() && ID.matcher(p[3]).matches();
    }
    if (p.length == 5 && p[0].equals("wiki") && p[1].equals("spaces") && p[3].equals("pages")) {
      return ID.matcher(p[2]).matches() && ID.matcher(p[4]).matches();
    }
    if (p.length == 3 && p[0].equals("wiki") && p[1].equals("open")) {
      return ID.matcher(p[2]).matches();
    }
    if (p.length == 3 && p[0].equals("drive") && p[1].equals("spaces") && m.group(3) != null) {
      Matcher f = FILE_PARAM.matcher(m.group(3));
      return ID.matcher(p[2]).matches() && f.find() && ID.matcher(f.group(1)).matches();
    }
    return false;
  }

  /** 공개 웹 주소의 호스트(소문자, 포트 제외). 비었거나 읽을 수 없으면 null. */
  private static String hostOf(String url) {
    if (url == null || url.isBlank()) return null;
    Matcher m = URL_PARTS.matcher(url.trim());
    return m.matches() ? m.group(1).toLowerCase(Locale.ROOT) : null;
  }

  /** 테넌트가 없으면(전파 실패) RLS 가 막으므로 건너뛰고 남긴다. 미리보기는 best-effort — 실패는 로그만. */
  private void submit(long messageId, String body, List<String> urls) {
    if (TenantContext.get() == null) {
      log.warn("[link-preview] 테넌트 컨텍스트 없음 — 건너뜀 messageId={}", messageId);
      return;
    }
    executor.execute(
        () -> {
          try {
            service.refresh(messageId, body, urls);
          } catch (Exception ex) {
            log.warn("[link-preview] 미리보기 갱신 실패 messageId={}: {}", messageId, ex.getMessage());
          }
        });
  }
}
