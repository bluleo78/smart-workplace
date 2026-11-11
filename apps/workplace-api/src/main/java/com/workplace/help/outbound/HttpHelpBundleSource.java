package com.workplace.help.outbound;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.outbound.InternalHttp;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.help.HelpProperties;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * 웹의 정적 파일에서 도움말 묶음을 읽는다(WP-1509) — 먼저 index 로 장 목록·audience 를 얻고 장마다 장 파일을 받는다.
 *
 * <p>왜 엄격한가: 웹은 없는 경로에 SPA 의 index.html 을 200 으로 돌려준다. 그걸 묶음으로 받아들이거나 한 장이라도 빠뜨리면 색인기가 빠진 절을 지운다.
 * 그래서 200 이 아니거나 JSON 이 아니면, 또 장 하나라도 못 읽으면 예외를 던져 묶음 전체를 버린다.
 */
@Component
public class HttpHelpBundleSource implements HelpBundleSource {

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

  private final String base;
  private final HttpClient http;
  private final ObjectMapper mapper = new ObjectMapper();

  public HttpHelpBundleSource(HelpProperties props) {
    // 끝 슬래시를 떼 경로를 이을 때 겹치지 않게. HTTP/1.1 고정 — InternalHttp 참조
    this.base = CapabilityTokens.normalizeBaseUrl(props.bundleBaseUrl());
    this.http = InternalHttp.httpClientBuilder().connectTimeout(CONNECT_TIMEOUT).build();
  }

  @Override
  public HelpBundle fetch() throws IOException {
    // 웹의 목차 파일은 {"chapters":[...]} 가 아니라 장 배열 자체다(docs/manual/scripts/lib/help-bundle.mjs).
    List<HelpBundle.Chapter> index =
        get("/help/manual-index.json", new TypeReference<List<HelpBundle.Chapter>>() {});
    if (index == null) throw new IOException("도움말 index 가 비어 있다");
    List<HelpBundle.Chapter> out = new ArrayList<>();
    for (HelpBundle.Chapter entry : index) {
      String file =
          "/help/manual/"
              + URLEncoder.encode(entry.chapter(), StandardCharsets.UTF_8).replace("+", "%20")
              + ".json";
      HelpBundle.Chapter body = get(file, new TypeReference<HelpBundle.Chapter>() {});
      // 장 제목·audience 는 index 쪽 값을 쓴다 — 장 파일에는 절만 있으면 된다.
      out.add(
          new HelpBundle.Chapter(
              entry.chapter(), entry.title(), entry.audience(), body.sections()));
    }
    return new HelpBundle(out);
  }

  /** GET 해 JSON 으로 읽는다. 200 이 아니거나 JSON 이 아니면 IOException. */
  private <T> T get(String path, TypeReference<T> type) throws IOException {
    HttpRequest req =
        HttpRequest.newBuilder(URI.create(base + path)).timeout(REQUEST_TIMEOUT).GET().build();
    try {
      HttpResponse<byte[]> res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
      if (res.statusCode() != 200) {
        throw new IOException("도움말 파일 응답 " + res.statusCode() + ": " + path);
      }
      return mapper.readValue(res.body(), type);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IOException("도움말 파일 읽기 중단: " + path, e);
    }
  }
}
