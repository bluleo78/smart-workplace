package com.workplace.messaging.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.support.IntegrationTestBase;
import java.io.InputStream;
import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 미리보기를 가져올 URL 고르기(WP-896) — 우리 앱 주소(공개 웹 주소와 같은 호스트)는 웹이 앱 카드로 그리므로 OG 가져오기에서 뺀다. 테스트 프로필의 공개 웹
 * 주소는 기본값 http://localhost:6173 이다.
 */
class LinkPreviewDispatcherTest extends IntegrationTestBase {
  @Autowired LinkPreviewDispatcher dispatcher;

  @Test
  void 우리_앱_호스트의_링크는_빼고_나머지는_본문_순서대로() {
    String body =
        "이슈 http://localhost:6173/projects/WP/issues/1 와 https://example.com/a 그리고"
            + " HTTP://LOCALHOST:6173/wiki/open/3 , https://example.org/b";
    // 본문 앞 3개 안에서 고른다 — 앱 링크 둘이 몫을 차지해 example.org 는 넷째라 빠진다(웹 카드 수 상한과 같다).
    assertThat(dispatcher.externalUrls(body)).containsExactly("https://example.com/a");
  }

  @Test
  void 포트가_달라도_같은_호스트면_앱_주소로_본다() {
    assertThat(dispatcher.externalUrls("http://localhost:9999/drive/spaces/1?file=2")).isEmpty();
    assertThat(dispatcher.externalUrls("https://localhost.example.com/x"))
        .containsExactly("https://localhost.example.com/x");
  }

  @Test
  void 같은_호스트라도_카드가_없는_경로는_지금처럼_가져온다() {
    // 공개 노트 공유 링크는 자기 OG 메타(WP-895)가 있어 미리보기를 그대로 만든다.
    assertThat(
            dispatcher.externalUrls(
                "http://localhost:6173/wiki/share/abc http://localhost:6173/projects/WP/issues/x"
                    + " http://localhost:6173/drive/spaces/5"))
        .containsExactly(
            "http://localhost:6173/wiki/share/abc",
            "http://localhost:6173/projects/WP/issues/x",
            "http://localhost:6173/drive/spaces/5");
  }

  @Test
  void 대괄호가_든_앱_주소도_앱_카드로_본다() {
    // URI 로는 읽지 못하는 문자([ ])가 있어도 웹(new URL)과 같게 앱 카드로 보고 뺀다 — 껍데기 OG 카드가 겹치지 않게.
    assertThat(dispatcher.externalUrls("http://localhost:6173/drive/spaces/5?x=[1]&file=77"))
        .isEmpty();
  }

  @Test
  void 웹과_같은_사례_표로_앱_카드_주소를_판정한다() throws Exception {
    // 웹 lib/appLinks.test.ts 도 같은 표를 읽는다 — 한쪽 문법(경로·자릿수 상한)만 바뀌면 그쪽 테스트가 실패한다(WP-1165).
    JsonNode table;
    try (InputStream in = getClass().getResourceAsStream("/app-links/app-card-urls.json")) {
      table = new ObjectMapper().readTree(in);
    }
    // 테스트 프로필의 공개 웹 주소(http://localhost:6173)가 표의 호스트와 같아야 한다.
    assertThat(table.get("host").asText()).isEqualTo("localhost");
    SoftAssertions soft = new SoftAssertions();
    for (JsonNode c : table.get("cases")) {
      String url = c.get("url").asText();
      soft.assertThat(dispatcher.isAppCardUrl(url)).as(url).isEqualTo(c.get("card").asBoolean());
    }
    soft.assertAll();
  }
}
