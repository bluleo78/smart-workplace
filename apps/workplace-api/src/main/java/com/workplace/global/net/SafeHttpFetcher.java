package com.workplace.global.net;

import java.io.IOException;
import java.io.InputStream;
import java.net.IDN;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collection;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.http.Header;
import org.apache.hc.core5.http.HttpEntity;
import org.apache.hc.core5.http.HttpHost;
import org.apache.hc.core5.net.URIAuthority;
import org.apache.hc.core5.util.Timeout;

/**
 * 사용자가 적은 외부 URL 을 서버가 대신 가져오는 가드된 HTTP GET(WP-874 링크 미리보기·썸네일 프록시). 서버가 대신 접속하는 경로라 SSRF 를 막는 규칙을
 * 한 곳에 모은다.
 *
 * <p>규칙: scheme http/https 만, 포트 80/443(또는 생략)만, {@code localhost}·{@code *.localhost} 거절, 호스트를 모든
 * IP 로 풀어 하나라도 {@link InternalAddresses#isInternal} 이면 거절(풀리지 않아도 거절 — fail-closed). 리다이렉트는 자동 추적하지
 * 않고 최대 3회 수동으로 따라가며 매 홉 같은 검사를 다시 한다. 연결·읽기 타임아웃 3초, 리다이렉트를 포함한 전체 5초, 본문은 호출자가 정한 상한을 넘으면 중단한다.
 *
 * <p>DNS 재바인딩 방지: 검사 시점과 연결 시점에 이름을 따로 풀면 그 사이 공격자 DNS 가 내부 IP 를 돌려줄 수 있다. JDK HttpClient 는 이름 해석을
 * 갈아끼울 수 없고 IP 로 직접 붙으면 TLS SNI·인증서 호스트 검증이 깨진다. 그래서 Apache HttpClient5 의 {@link DnsResolver} 를
 * 검사형으로 바꿔, 연결 계층이 쓰는 바로 그 해석 결과를 검사하고 통과한 주소로만 소켓을 연다(호스트 이름은 그대로라 TLS 는 정상 검증). 시스템 프록시 설정({@code
 * useSystemProperties})은 쓰지 않는다 — 프록시가 끼면 이름 해석이 프록시로 넘어가 검사를 우회한다.
 */
public class SafeHttpFetcher {

  /** 연결·읽기(소켓) 타임아웃. */
  static final Timeout HOP_TIMEOUT = Timeout.ofSeconds(3);

  /** 리다이렉트를 포함한 요청 1건의 전체 시간 상한(ms). */
  static final long TOTAL_TIMEOUT_MS = 5_000;

  /** 수동으로 따라갈 리다이렉트 최대 횟수. */
  static final int MAX_REDIRECTS = 3;

  static final String USER_AGENT = "GeniaWorksLinkPreview/1.0 (+link preview bot)";

  /** 호스트 이름 → 주소 목록. 테스트가 실제 DNS 없이 결과를 정하도록 분리한다. */
  @FunctionalInterface
  public interface HostResolver {
    InetAddress[] resolve(String host) throws UnknownHostException;
  }

  /**
   * 가져오기 실패(차단·타임아웃·상한 초과·형식 불일치 등). 호출자는 미리보기 없음/404 로 다룬다. transientFailure 는 다시 시도하면 될 수도 있는
   * 실패(연결·읽기 타임아웃, 5xx·429, 커넥션 풀 대기 초과 등) — 호출자가 결과를 오래 캐시하지 않도록 구분한다.
   */
  public static class FetchException extends Exception {
    private final boolean transientFailure;

    /** 확정 실패(차단·형식·상한·4xx 등) — 다시 해도 같은 결과. */
    public FetchException(String message) {
      this(message, false);
    }

    public FetchException(String message, boolean transientFailure) {
      super(message);
      this.transientFailure = transientFailure;
    }

    /** 일시적 실패인지 — true 면 결과를 짧게만 캐시한다. */
    public boolean isTransient() {
      return transientFailure;
    }
  }

  /** 접속 대상(정규화한 호스트·포트, 포트 생략은 -1). */
  record Target(String scheme, String host, int port) {}

  /** 검사형 리졸버가 내부 주소를 만나면 던진다. HttpClient 가 연결 실패로 그대로 올려 보내도록 UnknownHostException 을 잇는다. */
  static class BlockedAddressException extends UnknownHostException {
    BlockedAddressException(String host) {
      super("내부 주소로 풀리는 호스트라 접속하지 않습니다: " + host);
    }
  }

  /**
   * 가져온 응답.
   *
   * @param finalUri 리다이렉트를 따라간 마지막 주소(상대 경로 절대화 기준)
   * @param mimeType 소문자 MIME(파라미터 제외), 없으면 빈 문자열
   * @param charset Content-Type 의 charset 파라미터(없으면 null)
   */
  public record Fetched(URI finalUri, String mimeType, String charset, byte[] body) {}

  private final HostResolver resolver;
  // 내부 주소·임의 포트 검사를 건너뛰는 호스트. 운영은 비어 있다 — 로컬 HTTP 서버로 리다이렉트·상한을 시험하는 테스트 전용.
  private final Set<String> trustedHosts;
  private final CloseableHttpClient client;
  // 전체 5초 상한을 강제하려고 진행 중인 요청을 취소하는 타이머(HttpClient5 에는 전체 타임아웃이 없다).
  private final ScheduledExecutorService canceller;

  /** 운영 기본 — 실제 DNS, 신뢰 호스트 없음. */
  public SafeHttpFetcher() {
    this(InetAddress::getAllByName, Set.of());
  }

  /**
   * 리졸버·신뢰 호스트를 정해 만든다. 신뢰 호스트는 테스트에서 127.0.0.1 로컬 서버를 쓰기 위한 스위치다 — 운영 빈은 쓰지 않는다.
   *
   * @param trustedHosts 내부 주소·포트 검사를 건너뛸 호스트(소문자 비교)
   */
  public SafeHttpFetcher(HostResolver resolver, Collection<String> trustedHosts) {
    this.resolver = resolver;
    this.trustedHosts =
        trustedHosts.stream()
            .map(h -> h.toLowerCase(Locale.ROOT))
            .collect(Collectors.toUnmodifiableSet());
    DnsResolver guarded =
        new DnsResolver() {
          @Override
          public InetAddress[] resolve(String host) throws UnknownHostException {
            return vettedAddresses(host);
          }

          @Override
          public String resolveCanonicalHostname(String host) throws UnknownHostException {
            // 정규 이름 조회는 쓰지 않는다 — 검사한 이름 그대로 돌려준다.
            return host;
          }
        };
    this.client =
        HttpClients.custom()
            .setConnectionManager(
                PoolingHttpClientConnectionManagerBuilder.create()
                    .setDnsResolver(guarded)
                    .setDefaultConnectionConfig(
                        ConnectionConfig.custom()
                            .setConnectTimeout(HOP_TIMEOUT)
                            .setSocketTimeout(HOP_TIMEOUT)
                            .build())
                    // 가져오기 실행기(12)·썸네일 요청이 함께 쓴다. 한 사이트 링크 3개를 나란히 가져와도 풀 대기에 걸리지 않을 만큼,
                    // 그러면서 한 호스트를 과하게 두드리지 않도록 호스트당 6.
                    .setMaxConnTotal(40)
                    .setMaxConnPerRoute(6)
                    .build())
            .setDefaultRequestConfig(
                RequestConfig.custom()
                    .setResponseTimeout(HOP_TIMEOUT)
                    .setConnectionRequestTimeout(Timeout.ofSeconds(1))
                    .build())
            .disableRedirectHandling()
            .disableAutomaticRetries()
            .disableCookieManagement()
            .disableAuthCaching()
            .disableContentCompression()
            .build();
    this.canceller =
        Executors.newSingleThreadScheduledExecutor(
            r -> {
              Thread t = new Thread(r, "safe-http-cancel");
              t.setDaemon(true);
              return t;
            });
  }

  /** 앱 종료 시 커넥션 풀·타이머 정리. @Bean 의 추론된 destroy 메서드(close)로 불린다. */
  public void close() {
    canceller.shutdownNow();
    try {
      client.close();
    } catch (IOException ignored) {
      // 종료 경로 — 무시
    }
  }

  /**
   * url 을 가드된 GET 으로 가져온다.
   *
   * @param accept Accept 헤더 값
   * @param mimeAllowed 최종 응답 MIME 허용 여부(소문자, 파라미터 제외)
   * @param maxBytes 본문 상한 — 넘으면 중단하고 실패
   */
  public Fetched fetch(String url, String accept, Predicate<String> mimeAllowed, int maxBytes)
      throws FetchException {
    long deadline = System.currentTimeMillis() + TOTAL_TIMEOUT_MS;
    URI current = parse(url);
    for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
      Target target = checkUri(current);
      HttpGet get = new HttpGet(current);
      // 밑줄 든 호스트(my_site.example.com)는 URI#getHost 가 null 이라 HttpClient 가 대상을 못 정한다 — 직접 정한 대상으로
      // 고정한다.
      get.setScheme(target.scheme());
      get.setAuthority(new URIAuthority(target.host(), target.port()));
      get.setHeader("User-Agent", USER_AGENT);
      get.setHeader("Accept", accept);
      get.setHeader("Accept-Language", "ko,en;q=0.8");
      long remaining = deadline - System.currentTimeMillis();
      if (remaining <= 0) throw new FetchException("시간 초과", true);
      // 남은 시간이 지나면 요청을 취소해 소켓을 끊는다 — 느리게 흘려보내는 응답이 5초를 넘기지 못하게.
      ScheduledFuture<?> timer = canceller.schedule(get::cancel, remaining, TimeUnit.MILLISECONDS);
      try (ClassicHttpResponse res =
          client.executeOpen(
              new HttpHost(target.scheme(), target.host(), target.port()), get, null)) {
        int status = res.getCode();
        if (isRedirect(status)) {
          Header location = res.getFirstHeader("Location");
          if (location == null) throw new FetchException("리다이렉트 위치 없음");
          current = resolveRedirect(current, location.getValue());
          continue;
        }
        if (status < 200 || status >= 300) {
          // 5xx·429·408 은 잠시 뒤 나아질 수 있다 — 일시 실패로 표시. 그 밖의 4xx 는 확정.
          boolean retryable = status >= 500 || status == 429 || status == 408;
          throw new FetchException("응답 코드 " + status, retryable);
        }
        HttpEntity entity = res.getEntity();
        if (entity == null) throw new FetchException("본문 없음");
        String[] ct = parseContentType(entity.getContentType());
        if (!mimeAllowed.test(ct[0])) throw new FetchException("허용하지 않는 형식 " + ct[0]);
        if (entity.getContentLength() > maxBytes) throw new FetchException("본문 상한 초과");
        byte[] body = readCapped(entity, maxBytes);
        return new Fetched(current, ct[0], ct[1], body);
      } catch (BlockedAddressException e) {
        throw new FetchException("내부 주소 차단");
      } catch (IOException e) {
        // 연결 실패·타임아웃·취소(전체 시간 초과)·풀 대기 초과 — 모두 일시 실패.
        throw new FetchException("가져오기 실패: " + e.getClass().getSimpleName(), true);
      } finally {
        timer.cancel(false);
      }
    }
    throw new FetchException("리다이렉트가 너무 많습니다");
  }

  /** URL 문자열을 URI 로. 형식이 틀리면 실패. */
  private static URI parse(String url) throws FetchException {
    try {
      return new URI(url);
    } catch (URISyntaxException e) {
      throw new FetchException("올바르지 않은 주소");
    }
  }

  /**
   * 접속 전 구문 검사 — scheme·호스트·사용자 정보·포트·localhost. IP 대역 검사는 하지 않는다: 연결 계층의 검사형 리졸버가 이름을 한 번만 풀어 그
   * 결과를 검사하고 바로 그 주소로 연결한다(IP 리터럴도 같은 경로). 여기서 따로 풀면 DNS 조회가 홉마다 두 번이 되고 두 결과가 다를 수도 있다.
   *
   * @return 접속 대상(정규화 호스트)
   */
  Target checkUri(URI uri) throws FetchException {
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!scheme.equals("http") && !scheme.equals("https")) throw new FetchException("http(s) 만");
    // 사용자 정보(user@host)는 주소를 속이는 데 쓰인다 — 받지 않는다(밑줄 호스트처럼 getHost 가 null 인 경우도 authority 로 본다).
    String authority = uri.getRawAuthority();
    if (uri.getRawUserInfo() != null || (authority != null && authority.contains("@"))) {
      throw new FetchException("사용자 정보가 든 주소");
    }
    String rawHost = uri.getHost();
    int port = uri.getPort();
    if (rawHost == null && authority != null) {
      // java.net.URI 는 밑줄 든 호스트를 서버 기반 authority 로 못 읽어 host 가 null 이다 — authority 를 직접 나눈다.
      int colon = authority.lastIndexOf(':');
      rawHost = colon >= 0 ? authority.substring(0, colon) : authority;
      if (colon >= 0) {
        String p = authority.substring(colon + 1);
        if (!p.matches("\\d{1,5}")) throw new FetchException("올바르지 않은 포트");
        port = Integer.parseInt(p);
      }
      if (!rawHost.matches("[A-Za-z0-9._-]+")) throw new FetchException("올바르지 않은 호스트");
    }
    String host = normalizeHost(rawHost);
    if (host == null || host.isEmpty()) throw new FetchException("호스트 없음");
    // 생략된 포트는 scheme 기본값으로 채운다 — 연결 대상을 직접 정하므로 HttpClient 의 기본 포트 해석에 기대지 않는다.
    int effectivePort = port != -1 ? port : (scheme.equals("https") ? 443 : 80);
    if (trustedHosts.contains(host)) return new Target(scheme, host, effectivePort);
    if (effectivePort != 80 && effectivePort != 443) throw new FetchException("허용하지 않는 포트");
    if (host.equals("localhost") || host.endsWith(".localhost")) {
      throw new FetchException("내부 주소 차단");
    }
    return new Target(scheme, host, effectivePort);
  }

  /** 호스트를 모든 IP 로 풀고 하나라도 내부 대역이면 거절. 통과한 주소 배열을 그대로 연결에 쓴다. */
  InetAddress[] vettedAddresses(String rawHost) throws UnknownHostException {
    String host = normalizeHost(rawHost);
    if (host == null || host.isEmpty()) throw new UnknownHostException("빈 호스트");
    // localhost 이름은 checkUri 가 먼저 거르고, 그래도 여기 오면 루프백으로 풀려 아래 대역 검사에 걸린다.
    InetAddress[] addresses = resolver.resolve(host);
    if (addresses == null || addresses.length == 0) throw new UnknownHostException(host);
    if (Arrays.stream(addresses).anyMatch(InternalAddresses::isInternal)
        && !trustedHosts.contains(host)) {
      throw new BlockedAddressException(host);
    }
    return addresses;
  }

  /** 대괄호(IPv6)·끝 점 제거, 소문자, 국제화 도메인은 ASCII(punycode)로. */
  static String normalizeHost(String host) {
    if (host == null) return null;
    String h = host.replaceAll("^\\[|\\]$", "").toLowerCase(Locale.ROOT);
    while (h.endsWith(".")) h = h.substring(0, h.length() - 1);
    try {
      return h.contains(":") ? h : IDN.toASCII(h);
    } catch (IllegalArgumentException e) {
      return h;
    }
  }

  private static boolean isRedirect(int status) {
    return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
  }

  /** Location 을 현재 주소 기준으로 절대화. 날 공백·비-ASCII 등 URI 에 못 쓰는 글자는 브라우저처럼 퍼센트 인코딩한 뒤 푼다. */
  static URI resolveRedirect(URI base, String location) throws FetchException {
    try {
      return base.resolve(new URI(encodeIllegal(location.trim())));
    } catch (URISyntaxException | IllegalArgumentException e) {
      throw new FetchException("올바르지 않은 리다이렉트 위치");
    }
  }

  /**
   * URI 에 그대로 쓸 수 없는 글자(제어 문자·공백·{@code "<>\\^`{|}}·비-ASCII)를 UTF-8 퍼센트 인코딩한다. 이미 인코딩된 {@code %XX}
   * 는 그대로 두고, 뒤에 16진 두 자리가 없는 {@code %} 만 {@code %25} 로 바꾼다.
   */
  static String encodeIllegal(String s) {
    StringBuilder out = new StringBuilder(s.length() + 16);
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '%') {
        boolean encoded = i + 2 < s.length() && isHex(s.charAt(i + 1)) && isHex(s.charAt(i + 2));
        out.append(encoded ? "%" : "%25");
      } else if (c > 0x20 && c < 0x7f && "\"<>\\^`{|}".indexOf(c) < 0) {
        out.append(c);
      } else {
        int cp = s.codePointAt(i);
        if (Character.charCount(cp) == 2) i++;
        for (byte b : new String(Character.toChars(cp)).getBytes(StandardCharsets.UTF_8)) {
          out.append('%').append(String.format("%02X", b & 0xff));
        }
      }
    }
    return out.toString();
  }

  private static boolean isHex(char c) {
    return Character.digit(c, 16) >= 0;
  }

  /** Content-Type → [소문자 MIME, charset 또는 null]. */
  static String[] parseContentType(String contentType) {
    if (contentType == null) return new String[] {"", null};
    String[] parts = contentType.split(";");
    String mime = parts[0].trim().toLowerCase(Locale.ROOT);
    String charset = null;
    for (int i = 1; i < parts.length; i++) {
      String p = parts[i].trim();
      if (p.toLowerCase(Locale.ROOT).startsWith("charset=")) {
        charset = p.substring("charset=".length()).replace("\"", "").trim();
      }
    }
    return new String[] {mime, charset};
  }

  /** 본문을 상한까지만 읽는다. 전체 시간 초과는 취소 타이머가 소켓을 끊어 read 가 IOException 으로 끝난다. */
  private static byte[] readCapped(HttpEntity entity, int maxBytes)
      throws IOException, FetchException {
    try (InputStream in = entity.getContent()) {
      byte[] buf = new byte[8192];
      java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
      int n;
      while ((n = in.read(buf)) != -1) {
        if (out.size() + n > maxBytes) throw new FetchException("본문 상한 초과");
        out.write(buf, 0, n);
      }
      return out.toByteArray();
    }
  }
}
