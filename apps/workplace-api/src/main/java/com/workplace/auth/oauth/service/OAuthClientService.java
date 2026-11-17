package com.workplace.auth.oauth.service;

import static com.workplace.auth.oauth.exception.OAuthErrors.INVALID_CLIENT;
import static com.workplace.auth.oauth.exception.OAuthErrors.INVALID_CLIENT_METADATA;
import static com.workplace.auth.oauth.exception.OAuthErrors.INVALID_REDIRECT_URI;

import com.workplace.auth.oauth.dto.RegisterClientRequest;
import com.workplace.auth.oauth.dto.RegisteredClient;
import com.workplace.auth.oauth.exception.OAuthClientException;
import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.repository.OAuthClientRepository.ClientRow;
import com.workplace.global.net.InternalAddresses;
import com.workplace.global.net.SafeHttpFetcher;
import com.workplace.global.net.SafeHttpFetcher.FetchException;
import com.workplace.global.net.SafeHttpFetcher.Fetched;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.Texts;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * OAuth 클라이언트 해석과 동적 등록(WP-1685).
 *
 * <p>client_id 는 두 갈래다. {@code swc_} 로 시작하면 DCR(RFC 7591)로 등록된 행을 표에서 찾고, {@code https} URL 이면
 * CIMD(Client ID Metadata Document) — 그 URL 의 JSON 문서를 가져와 이름·redirect_uris 를 쓴다. CIMD 는 서버가 사용자가 준
 * 주소로 대신 접속하는 경로라 SSRF 를 두 번 막는다: 가져오기 전에 호스트를 직접 풀어 내부 대역이면 거절(가져오기 호출 없음)하고, 가져오기 자체도 {@link
 * SafeHttpFetcher}(80/443·리다이렉트 재검사·DNS 재바인딩 방지)로 한다.
 *
 * <p>CIMD 캐시: 행의 fetched_at 이 1시간 안이면 다시 가져오지 않는다. 가져오기 실패면 24시간 안의 캐시를 그대로 쓰고, 아니면 invalid_client.
 * 가져온 문서가 규칙에 맞지 않으면(client_id 불일치·redirect_uris 없음 등) 캐시가 있어도 거절한다 — 발행자가 바꾼 문서를 옛 캐시로 덮지 않는다.
 *
 * <p>트랜잭션을 두지 않는다 — CIMD 가져오기(최대 5초) 동안 DB 커넥션을 잡지 않게. 표는 RLS 없는 전역 표라 테넌트 GUC 가 필요 없다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OAuthClientService {

  /** DCR client_id 접두사. */
  public static final String DCR_PREFIX = "swc_";

  /** DCR 이름이 없을 때 쓰는 표시 이름. */
  static final String DEFAULT_CLIENT_NAME = "이름 없는 앱";

  /** 클라이언트 표시 이름 최대 길이(자). */
  static final int MAX_CLIENT_NAME = 100;

  /** CIMD 문서 최대 크기(바이트). */
  static final int CIMD_MAX_BYTES = 5120;

  /** CIMD 캐시를 다시 가져오지 않고 쓰는 시간. */
  static final Duration CIMD_FRESH = Duration.ofHours(1);

  /** 가져오기가 실패했을 때 옛 캐시를 쓸 수 있는 시간. */
  static final Duration CIMD_STALE_MAX = Duration.ofHours(24);

  /** 받는 grant — 그 밖은 등록 거절. */
  private static final Set<String> SUPPORTED_GRANTS = Set.of("authorization_code", "refresh_token");

  private final OAuthClientRepository clients;
  private final SafeHttpFetcher fetcher;
  private final ObjectMapper objectMapper;

  /**
   * 해석된 클라이언트 — 인가·토큰 엔드포인트가 쓴다.
   *
   * @param kind {@code CIMD} 또는 {@code DCR}(DCR 은 동의 화면에 「확인되지 않은 앱」으로 보인다)
   * @param clientUri 표시용 홈페이지(CIMD 문서에 있을 때만, 없으면 null)
   */
  public record ResolvedClient(
      long id,
      String clientId,
      String kind,
      String clientName,
      List<String> redirectUris,
      String clientUri) {

    /** DCR(앱이 스스로 등록)이라 동의 화면에 「확인되지 않은 앱」으로 보일 클라이언트인지. */
    public boolean unverified() {
      return OAuthClientRepository.KIND_DCR.equals(kind);
    }
  }

  /**
   * client_id 를 클라이언트로 푼다.
   *
   * @throws OAuthClientException 알 수 없음·CIMD 를 쓸 수 없음(error 는 늘 {@code invalid_client})
   */
  public ResolvedClient resolve(String clientId) {
    if (clientId == null || clientId.isBlank()) {
      throw invalidClient("client_id 가 없습니다.");
    }
    if (clientId.startsWith(DCR_PREFIX)) {
      return clients
          .findByClientId(clientId)
          .filter(r -> OAuthClientRepository.KIND_DCR.equals(r.kind()))
          .map(OAuthClientService::toResolved)
          .orElseThrow(() -> invalidClient("등록되지 않은 클라이언트입니다."));
    }
    if (clientId.regionMatches(true, 0, "http", 0, 4)) {
      return resolveCimd(clientId);
    }
    throw invalidClient("알 수 없는 client_id 형식입니다.");
  }

  /**
   * 동적 클라이언트 등록(RFC 7591). 공개 클라이언트(token_endpoint_auth_method=none)만 받는다.
   *
   * @throws OAuthClientException {@code invalid_redirect_uri}·{@code invalid_client_metadata}
   */
  public RegisteredClient register(RegisterClientRequest req) {
    if (req == null) {
      throw new OAuthClientException(INVALID_CLIENT_METADATA, "등록 본문이 없습니다.");
    }
    Optional<String> redirectProblem = RedirectUris.validateForRegistration(req.redirectUris());
    if (redirectProblem.isPresent()) {
      throw new OAuthClientException(INVALID_REDIRECT_URI, redirectProblem.get());
    }
    String authMethod = req.tokenEndpointAuthMethod();
    if (authMethod != null && !"none".equals(authMethod)) {
      throw new OAuthClientException(
          INVALID_CLIENT_METADATA, "token_endpoint_auth_method 는 none(공개 클라이언트)만 받습니다.");
    }
    if (req.grantTypes() != null && !onlyAllowed(req.grantTypes(), SUPPORTED_GRANTS)) {
      throw new OAuthClientException(
          INVALID_CLIENT_METADATA, "grant_types 는 authorization_code·refresh_token 만 받습니다.");
    }
    if (req.responseTypes() != null && !onlyAllowed(req.responseTypes(), Set.of("code"))) {
      throw new OAuthClientException(INVALID_CLIENT_METADATA, "response_types 는 code 만 받습니다.");
    }
    String stripped = Texts.stripToNull(req.clientName());
    if (stripped != null && stripped.codePointCount(0, stripped.length()) > MAX_CLIENT_NAME) {
      throw new OAuthClientException(
          INVALID_CLIENT_METADATA, "client_name 은 " + MAX_CLIENT_NAME + "자 이하여야 합니다.");
    }
    String name = stripped == null ? DEFAULT_CLIENT_NAME : stripped;

    ClientRow row =
        clients.insertDcr(
            CapabilityTokens.generate(DCR_PREFIX), name, List.copyOf(req.redirectUris()));
    return new RegisteredClient(
        row.clientId(),
        row.createdAt().toEpochSecond(),
        row.clientName(),
        row.redirectUris(),
        "none",
        req.grantTypes() == null
            ? List.of("authorization_code", "refresh_token")
            : req.grantTypes(),
        List.of("code"));
  }

  /**
   * 목록이 비지 않았고 모든 값이 허용 집합 안인지. null 원소({@code ["code", null]})는 허용하지 않는다 — {@code
   * Set.of(..).containsAll} 은 null 을 만나면 NPE 를 던져 500 이 되던 것을 400 {@code invalid_client_metadata} 로
   * 돌린다(리뷰 D3.1).
   */
  private static boolean onlyAllowed(List<String> values, Set<String> allowed) {
    return !values.isEmpty() && values.stream().allMatch(v -> v != null && allowed.contains(v));
  }

  // ---- CIMD ----

  /** CIMD client_id(URL) 해석 — 형식 검사 → 신선한 캐시 → 내부 주소 검사 → 가져오기 → 문서 검사·저장. */
  private ResolvedClient resolveCimd(String url) {
    URI uri = parseCimdUrl(url);
    Optional<ClientRow> cached =
        clients.findByClientId(url).filter(r -> OAuthClientRepository.KIND_CIMD.equals(r.kind()));
    OffsetDateTime now = OffsetDateTime.now();
    if (cached.isPresent() && isWithin(cached.get(), now, CIMD_FRESH)) {
      return toResolved(cached.get());
    }

    Fetched fetched;
    try {
      // 가져오기 전에 호스트를 직접 풀어 내부 대역이면 바로 거절한다 — 사설 주소로는 요청 자체를 내보내지 않는다(캐시가 있어도).
      rejectInternalHost(uri.getHost());
      fetched =
          fetcher.fetch(
              url, "application/json", mime -> "application/json".equals(mime), CIMD_MAX_BYTES);
    } catch (UnknownHostException | FetchException e) {
      // 일시적인 실패(이름 풀기·연결·5xx 등)는 하루 안의 캐시로 버틴다.
      if (cached.isPresent() && isWithin(cached.get(), now, CIMD_STALE_MAX)) {
        log.info("CIMD 문서를 가져오지 못해 캐시를 씁니다 — url={} reason={}", url, e.getMessage());
        return toResolved(cached.get());
      }
      throw invalidClient("클라이언트 메타데이터 문서를 가져오지 못했습니다.");
    }

    CimdDocument doc = parseDocument(url, fetched.body());
    return toResolved(
        clients.upsertCimd(
            url, doc.clientName(), doc.redirectUris(), doc.logoUri(), doc.clientUri(), now));
  }

  /**
   * CIMD URL 형식 검사 — https 만, 호스트 있음, 루트(/)만이 아닌 경로, 프래그먼트·사용자 정보 없음.
   *
   * @return 파싱한 URI
   */
  private static URI parseCimdUrl(String url) {
    if (url.length() > RedirectUris.MAX_LENGTH || url.indexOf('#') >= 0) {
      throw invalidClient("client_id 주소 형식이 올바르지 않습니다.");
    }
    URI uri;
    try {
      uri = new URI(url);
    } catch (URISyntaxException e) {
      throw invalidClient("client_id 주소 형식이 올바르지 않습니다.");
    }
    if (!"https".equals(uri.getScheme())) {
      throw invalidClient("client_id 주소는 https 여야 합니다.");
    }
    String authority = uri.getRawAuthority();
    if (uri.getRawUserInfo() != null || (authority != null && authority.contains("@"))) {
      throw invalidClient("client_id 주소에 사용자 정보를 넣을 수 없습니다.");
    }
    String path = uri.getRawPath();
    if (uri.getHost() == null || path == null || path.isEmpty() || "/".equals(path)) {
      throw invalidClient("client_id 주소에는 호스트와 경로가 있어야 합니다.");
    }
    return uri;
  }

  /**
   * 호스트를 모든 IP 로 풀어 하나라도 내부 대역(루프백·사설·링크로컬·CGNAT 등)이면 거절한다. IP 리터럴도 같은 길을 탄다(풀기만 하고 DNS 조회는 없다).
   * 풀리지 않으면 UnknownHostException — 호출자가 가져오기 실패로 다룬다.
   */
  private static void rejectInternalHost(String host) throws UnknownHostException {
    String h =
        host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
    InetAddress[] addresses = InetAddress.getAllByName(h);
    // getAllByName 은 풀지 못하면 빈 배열 대신 UnknownHostException 을 던진다 — 빈 배열 검사는 필요 없다.
    if (Arrays.stream(addresses).anyMatch(InternalAddresses::isInternal)) {
      throw invalidClient("내부 주소의 클라이언트 메타데이터 문서는 쓸 수 없습니다.");
    }
  }

  /** CIMD 문서에서 저장할 값. */
  private record CimdDocument(
      String clientName, List<String> redirectUris, String logoUri, String clientUri) {}

  /** 문서 검사 — JSON 객체, client_id 가 URL 과 같음, redirect_uris 가 규칙에 맞음. 이름 등은 다듬어 담는다. */
  private CimdDocument parseDocument(String url, byte[] body) {
    JsonNode root;
    try {
      root = objectMapper.readTree(body);
    } catch (JacksonException e) {
      throw invalidClient("클라이언트 메타데이터 문서가 JSON 이 아닙니다.");
    }
    if (root == null || !root.isObject()) {
      throw invalidClient("클라이언트 메타데이터 문서가 JSON 객체가 아닙니다.");
    }
    if (!url.equals(text(root, "client_id"))) {
      throw invalidClient("문서의 client_id 가 문서 주소와 다릅니다.");
    }
    JsonNode urisNode = root.get("redirect_uris");
    if (urisNode == null || !urisNode.isArray()) {
      throw invalidClient("문서에 redirect_uris 가 없습니다.");
    }
    List<String> uris = new ArrayList<>();
    for (JsonNode n : urisNode.values()) {
      if (!n.isString()) throw invalidClient("문서의 redirect_uris 형식이 올바르지 않습니다.");
      uris.add(n.asString());
    }
    Optional<String> problem = RedirectUris.validateForRegistration(uris);
    if (problem.isPresent()) {
      throw invalidClient("문서의 redirect_uris 가 규칙에 맞지 않습니다 — " + problem.get());
    }
    // 이름은 앞뒤 공백을 떼고(비면 기본 이름) 코드 포인트로 자른다 — 서로게이트 쌍(이모지 등)을 반으로 가르지 않는다(리뷰 D3.2).
    String stripped = Texts.stripToNull(text(root, "client_name"));
    String name =
        Texts.headCodePoints(stripped == null ? DEFAULT_CLIENT_NAME : stripped, MAX_CLIENT_NAME);
    return new CimdDocument(
        name,
        List.copyOf(uris),
        httpsOrNull(text(root, "logo_uri")),
        httpsOrNull(text(root, "client_uri")));
  }

  /** 문자열 필드 값, 없거나 문자열이 아니면 null. */
  private static String text(JsonNode root, String field) {
    JsonNode n = root.get(field);
    return n != null && n.isString() ? n.asString() : null;
  }

  /**
   * 표시용 주소(logo·홈페이지)는 https 이고 2000자 이하일 때만 담는다 — 동의 화면이 링크·이미지로 쓰므로 javascript: 같은 scheme 이나 지나치게
   * 긴 값을 저장하지 않는다.
   */
  private static String httpsOrNull(String value) {
    if (value == null || value.length() > RedirectUris.MAX_LENGTH) return null;
    try {
      URI u = new URI(value);
      return "https".equals(u.getScheme()) && u.getHost() != null ? value : null;
    } catch (URISyntaxException e) {
      return null;
    }
  }

  /** 캐시 행의 fetched_at 이 지금부터 window 안인지. */
  private static boolean isWithin(ClientRow row, OffsetDateTime now, Duration window) {
    return row.fetchedAt() != null && row.fetchedAt().isAfter(now.minus(window));
  }

  private static ResolvedClient toResolved(ClientRow r) {
    return new ResolvedClient(
        r.id(), r.clientId(), r.kind(), r.clientName(), r.redirectUris(), r.clientUri());
  }

  private static OAuthClientException invalidClient(String description) {
    return new OAuthClientException(INVALID_CLIENT, description);
  }
}
