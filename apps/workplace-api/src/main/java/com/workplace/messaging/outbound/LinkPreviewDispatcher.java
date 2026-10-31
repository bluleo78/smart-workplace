package com.workplace.messaging.outbound;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.PublicAppHost;
import com.workplace.messaging.service.LinkPreviewService;
import com.workplace.messaging.service.LinkUrlExtractor;
import java.util.Arrays;
import java.util.List;
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
    this.appHost = PublicAppHost.of(publicBaseUrl);
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

  // scheme://[userinfo@]host[:port][path][?query][#fragment] 로 나눈다.
  //   - URI.create 는 추출기가 받는 [ ] 등에서 실패해 직접 나눈다
  //   - userinfo 는 웹(URL.hostname)처럼 건너뛴다(WP-1165)
  private static final Pattern URL_PARTS =
      Pattern.compile(
          "^https?://(?:[^/?#@]*@)?([^/?#:]+)(?::\\d*)?([^?#]*)(?:\\?([^#]*))?.*$",
          Pattern.CASE_INSENSITIVE);
  // id 자릿수 상한(WP-1165) — 웹 lib/appLinks.ts 의 ISSUE_NUMBER·ID 와 같다.
  //   - 이슈 번호: 카드 API 가 int 로 받아 9자리까지
  //   - 노트·파일 id: 웹이 Number 로 바꿔도 값이 그대로인 15자리까지
  // 넘는 주소는 웹도 앱 카드로 그리지 않으니 OG 미리보기를 그대로 만든다.
  private static final Pattern ISSUE_NUMBER = Pattern.compile("[1-9][0-9]{0,8}");
  private static final Pattern ID = Pattern.compile("[1-9][0-9]{0,14}");
  private static final Pattern PROJECT_KEY = Pattern.compile("[A-Za-z][A-Za-z0-9]{1,9}");
  private static final Pattern FILE_PARAM = Pattern.compile("(?:^|&)file=([^&]*)");
  // 드라이브 미리보기 주소(WP-1235) — 웹의 🔗·⇧⌘, 가 복사하는 파일 링크(/drive/spaces/{s}?folderId=..&preview={id}).
  private static final Pattern PREVIEW_PARAM = Pattern.compile("(?:^|&)preview=([^&]*)");
  // 메시지·일정·메일 주소(WP-1236) — 웹의 「링크 복사」가 만드는 모양. 그 쿼리가 있어야 카드다(/chat/channels/5·/calendar 만은 아니다).
  private static final Pattern MESSAGE_PARAM = Pattern.compile("(?:^|&)message=([^&]*)");
  private static final Pattern EVENT_PARAM = Pattern.compile("(?:^|&)eventId=([^&]*)");
  private static final Pattern MAIL_PARAM = Pattern.compile("(?:^|&)messageId=([^&]*)");

  /**
   * 웹이 앱 카드로 그리는 주소인지 — 호스트가 우리 앱이고 경로가 {@code /projects/{KEY}/issues/{n}}·{@code
   * /wiki/spaces/{s}/pages/{id}}·{@code /wiki/open/{id}}·{@code /drive/spaces/{s}?file={id}}·{@code
   * /drive/spaces/{s}?preview={id}}·{@code /chat/channels/{c}?message={id}}·{@code
   * /chat/dms/{c}?message={id}}·{@code /calendar?eventId={id}}·{@code /mail/{a}?messageId={id}} 중
   * 하나(쿼리 값은 처음 나온 것만 본다). 웹 parseAppLink 와 같은 문법이어야 한다 — 두 쪽 테스트가 같은 사례
   * 표(test/resources/app-links/app-card-urls.json)를 읽어 어긋나면 실패한다.
   */
  boolean isAppCardUrl(String url) {
    Matcher m = URL_PARTS.matcher(url);
    if (!m.matches() || !PublicAppHost.normalizeHost(m.group(1)).equals(appHost)) return false;
    String[] p =
        Arrays.stream(m.group(2).split("/")).filter(x -> !x.isEmpty()).toArray(String[]::new);
    if (p.length == 4 && p[0].equals("projects") && p[2].equals("issues")) {
      return PROJECT_KEY.matcher(p[1]).matches() && ISSUE_NUMBER.matcher(p[3]).matches();
    }
    if (p.length == 5 && p[0].equals("wiki") && p[1].equals("spaces") && p[3].equals("pages")) {
      return ID.matcher(p[2]).matches() && ID.matcher(p[4]).matches();
    }
    if (p.length == 3 && p[0].equals("wiki") && p[1].equals("open")) {
      return ID.matcher(p[2]).matches();
    }
    if (p.length == 3 && p[0].equals("drive") && p[1].equals("spaces") && m.group(3) != null) {
      Matcher f = FILE_PARAM.matcher(m.group(3));
      Matcher pv = PREVIEW_PARAM.matcher(m.group(3));
      // file= 이 우선이고(웹 parseAppLink 와 같은 순서), 쓸 수 없으면 미리보기 id 를 본다.
      boolean byFile = f.find() && ID.matcher(f.group(1)).matches();
      boolean byPreview = pv.find() && ID.matcher(pv.group(1)).matches();
      return ID.matcher(p[2]).matches() && (byFile || byPreview);
    }
    // 메시지(WP-1236): /chat/channels|dms/{c}?message={id} — thread= 등 다른 쿼리가 함께 있어도 된다.
    if (p.length == 3
        && p[0].equals("chat")
        && (p[1].equals("channels") || p[1].equals("dms"))
        && ID.matcher(p[2]).matches()) {
      return idParam(MESSAGE_PARAM, m.group(3));
    }
    // 일정(WP-1236): /calendar?eventId={id}
    if (p.length == 1 && p[0].equals("calendar")) {
      return idParam(EVENT_PARAM, m.group(3));
    }
    // 메일(WP-1236): /mail/{accountId}?messageId={id}
    if (p.length == 2 && p[0].equals("mail") && ID.matcher(p[1]).matches()) {
      return idParam(MAIL_PARAM, m.group(3));
    }
    return false;
  }

  /** 쿼리에서 처음 나온 그 이름의 값이 카드 id(ID 문법)인지. 쿼리가 없으면 false. */
  private static boolean idParam(Pattern param, String query) {
    if (query == null) return false;
    Matcher q = param.matcher(query);
    return q.find() && ID.matcher(q.group(1)).matches();
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
