package com.workplace.support;

import com.workplace.global.net.SafeHttpFetcher;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.function.Predicate;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 통합 테스트용 링크 미리보기 가져오기(WP-874). 실제 {@link SafeHttpFetcher} 를 @Primary 로 덮어, 메시지 본문에 URL 이 든 테스트가
 * 커밋돼도 인터넷으로 나가지 않게 한다 — 아래 고정 URL 만 응답하고 나머지는 즉시 확정 실패. 모든 통합 테스트가 {@link IntegrationTestBase} 로
 * 같은 구성을 쓰므로 컨텍스트가 갈라지지 않는다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class FixtureHttpFetcherConfig {

  /** OG 메타가 있는 고정 페이지. */
  public static final String OG_PAGE = "https://fixture.test/og";

  /** OG_PAGE 의 og:image. */
  public static final String OG_IMAGE = "https://fixture.test/img.png";

  /** 최소 PNG 서명(판정용 16바이트). */
  public static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 'I', 'H', 'D', 'R'
  };

  @Bean
  @Primary
  public SafeHttpFetcher fixtureSafeHttpFetcher() {
    return new FixtureFetcher();
  }

  /** 고정 응답만 돌려주는 가져오기. 가드·네트워크는 거치지 않는다. */
  static final class FixtureFetcher extends SafeHttpFetcher {
    private static final Map<String, Fetched> FIXTURES =
        Map.of(
            OG_PAGE,
            new Fetched(
                URI.create(OG_PAGE),
                "text/html",
                "utf-8",
                ("<html><head><meta property=\"og:title\" content=\"픽스처 제목\">"
                        + "<meta property=\"og:site_name\" content=\"픽스처\">"
                        + "<meta property=\"og:image\" content=\""
                        + OG_IMAGE
                        + "\"></head></html>")
                    .getBytes(StandardCharsets.UTF_8)),
            OG_IMAGE,
            new Fetched(URI.create(OG_IMAGE), "image/png", null, PNG));

    @Override
    public Fetched fetch(String url, String accept, Predicate<String> mimeAllowed, int maxBytes)
        throws FetchException {
      Fetched f = FIXTURES.get(url);
      if (f == null || !mimeAllowed.test(f.mimeType())) {
        throw new FetchException("테스트 픽스처 없음: " + url);
      }
      return f;
    }
  }
}
