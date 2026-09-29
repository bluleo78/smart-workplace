package com.workplace.auth.sso;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

/**
 * 테스트용 멀티테넌트 Entra IdP(WP-48). JDK HttpServer 로 JWKS·토큰 엔드포인트를 낸다 — 테스트 의존성을 늘리지 않는다.
 *
 * <p>JVM 당 하나({@link #INSTANCE})만 띄워 SSO 테스트 클래스들이 같은 authority 로 Spring 컨텍스트를 공유하게 한다. 테스트는
 * {@code @BeforeEach} 에서 {@link #reset()} 으로 상태를 되돌린다. issuer 는 Entra 와 같이 {@code
 * {authority}/{tid}/v2.0}.
 */
public final class FakeEntraProvider {

  public static final String CLIENT_ID = "test-client";
  public static final FakeEntraProvider INSTANCE = start();

  private final HttpServer server;
  private volatile RSAKey key;
  private final List<RSAKey> published = new CopyOnWriteArrayList<>();
  private volatile Function<Map<String, String>, JWTClaimsSet> claims;
  private volatile int tokenStatus = 200;
  private volatile String tokenErrorBody;
  private volatile Map<String, String> lastForm = Map.of();
  private final AtomicInteger tokenCalls = new AtomicInteger();

  private static FakeEntraProvider start() {
    try {
      return new FakeEntraProvider();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private FakeEntraProvider() throws Exception {
    key = new RSAKeyGenerator(2048).keyID("k1").generate();
    published.add(key);
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    // 데몬 스레드 — 테스트 JVM 종료를 막지 않는다.
    server.setExecutor(
        Executors.newCachedThreadPool(
            r -> {
              Thread t = new Thread(r, "fake-entra");
              t.setDaemon(true);
              return t;
            }));
    server.createContext(
        "/common/discovery/v2.0/keys",
        ex ->
            json(
                ex,
                200,
                new JWKSet(published.stream().map(k -> (JWK) k.toPublicJWK()).toList())
                    .toString()));
    server.createContext("/organizations/oauth2/v2.0/token", this::token);
    server.start();
    reset();
  }

  /** authority 기본 URL — SsoProperties.authorityBaseUrl 로 주입된다. */
  public String authority() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  /** 테스트 간 상태 초기화 — 토큰 엔드포인트 정상화, 기본 클레임 제거(테스트가 반드시 지정). */
  public void reset() {
    tokenStatus = 200;
    tokenErrorBody = null;
    claims =
        form -> {
          throw new IllegalStateException("테스트가 claims 를 지정하지 않았습니다");
        };
    tokenCalls.set(0);
    lastForm = Map.of();
    if (!published.contains(key)) key = published.get(0);
  }

  public void claims(Function<Map<String, String>, JWTClaimsSet> f) {
    claims = f;
  }

  /** Entra v2 ID 토큰 기본형 — iss/aud/tid/oid/exp. nonce·upn 은 테스트가 더한다. */
  public JWTClaimsSet.Builder claimsBuilder(String tid, String oid) {
    return new JWTClaimsSet.Builder()
        .issuer(authority() + "/" + tid + "/v2.0")
        .audience(CLIENT_ID)
        .subject("pairwise-" + oid)
        .claim("tid", tid)
        .claim("oid", oid)
        .issueTime(new Date())
        .expirationTime(new Date(System.currentTimeMillis() + 300_000));
  }

  public void failTokenEndpoint(int status, String body) {
    tokenStatus = status;
    tokenErrorBody = body;
  }

  /** JWKS 에 없는 키로 서명 — 서명 위조 재현. reset() 이 되돌린다. */
  public void signWithUnpublishedKey() throws Exception {
    key = new RSAKeyGenerator(2048).keyID("k1").generate();
  }

  public int tokenCalls() {
    return tokenCalls.get();
  }

  public Map<String, String> lastTokenRequestForm() {
    return lastForm;
  }

  private void token(HttpExchange ex) throws IOException {
    tokenCalls.incrementAndGet();
    lastForm = parseForm(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
    if (tokenStatus != 200) {
      json(ex, tokenStatus, tokenErrorBody);
      return;
    }
    try {
      SignedJWT jwt =
          new SignedJWT(
              new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(),
              claims.apply(lastForm));
      jwt.sign(new RSASSASigner(key));
      json(
          ex,
          200,
          "{\"access_token\":\"at\",\"token_type\":\"Bearer\",\"id_token\":\""
              + jwt.serialize()
              + "\"}");
    } catch (JOSEException | RuntimeException e) {
      json(ex, 500, "{\"error\":\"fake_failure\"}");
    }
  }

  private static Map<String, String> parseForm(String body) {
    Map<String, String> form = new HashMap<>();
    for (String pair : body.split("&")) {
      if (pair.isEmpty()) continue;
      int i = pair.indexOf('=');
      String k = URLDecoder.decode(i < 0 ? pair : pair.substring(0, i), StandardCharsets.UTF_8);
      String v = i < 0 ? "" : URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8);
      form.put(k, v);
    }
    return form;
  }

  private static void json(HttpExchange ex, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    ex.sendResponseHeaders(status, bytes.length);
    try (OutputStream os = ex.getResponseBody()) {
      os.write(bytes);
    }
  }
}
