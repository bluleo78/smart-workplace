package com.workplace.help.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import com.workplace.help.HelpProperties;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** HttpHelpBundleSource — JDK HttpServer 로 웹의 정적 파일을 흉내 내 index → 장 파일 읽기와 실패 경로를 확인한다. */
class HttpHelpBundleSourceTest {

  private HttpServer server;
  private Map<String, String[]> routes; // path -> {status, contentType, body}

  @BeforeEach
  void start() throws IOException {
    routes = new java.util.concurrent.ConcurrentHashMap<>();
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        ex -> {
          String[] r = routes.get(ex.getRequestURI().getRawPath());
          if (r == null) r = new String[] {"404", "text/plain", "nope"};
          byte[] b = r[2].getBytes(StandardCharsets.UTF_8);
          ex.getResponseHeaders().add("Content-Type", r[1]);
          ex.sendResponseHeaders(Integer.parseInt(r[0]), b.length);
          ex.getResponseBody().write(b);
          ex.close();
        });
    server.start();
  }

  @AfterEach
  void stop() {
    server.stop(0);
  }

  private HttpHelpBundleSource source() {
    return new HttpHelpBundleSource(
        new HelpProperties("http://127.0.0.1:" + server.getAddress().getPort() + "/"));
  }

  private void json(String path, String body) {
    routes.put(path, new String[] {"200", "application/json", body});
  }

  @Test
  void fetchesIndexThenChapters() throws IOException {
    json(
        "/help/manual-index.json",
        "[{\"chapter\":\"01-start\",\"title\":\"시작\",\"audience\":[]},"
            + "{\"chapter\":\"02 admin\",\"title\":\"관리\",\"audience\":[\"admin\"]}]");
    json(
        "/help/manual/01-start.json",
        "{\"chapter\":\"01-start\",\"title\":\"시작\",\"extra\":1,\"sections\":["
            + "{\"id\":\"s1\",\"label\":\"라벨\",\"title\":\"제목\",\"markdown\":\"본문\"}]}");
    json(
        "/help/manual/02%20admin.json",
        "{\"sections\":[{\"id\":\"s2\",\"label\":\"\",\"title\":\"T2\",\"markdown\":\"m2\"}]}");

    HelpBundle b = source().fetch();

    assertThat(b.chapters()).hasSize(2);
    HelpBundle.Chapter c1 = b.chapters().get(0);
    assertThat(c1.chapter()).isEqualTo("01-start");
    assertThat(c1.title()).isEqualTo("시작");
    assertThat(c1.audience()).isEmpty();
    assertThat(c1.sections()).containsExactly(new HelpBundle.Section("s1", "라벨", "제목", "본문"));
    HelpBundle.Chapter c2 = b.chapters().get(1);
    assertThat(c2.audience()).containsExactly("admin");
    assertThat(c2.title()).isEqualTo("관리");
    assertThat(c2.sections()).hasSize(1);
  }

  @Test
  void nonJsonResponseThrows() {
    routes.put(
        "/help/manual-index.json",
        new String[] {"200", "text/html", "<!doctype html><html></html>"});
    assertThatThrownBy(() -> source().fetch()).isInstanceOf(IOException.class);
  }

  @Test
  void missingChapterThrows() {
    json(
        "/help/manual-index.json", "[{\"chapter\":\"01-start\",\"title\":\"시작\",\"audience\":[]}]");
    assertThatThrownBy(() -> source().fetch()).isInstanceOf(IOException.class);
  }

  /** 실제 생성기가 쓴 목차(배열)·장 파일 모양을 줄인 사본으로 읽는다 — 목차가 배열이라는 계약을 고정한다. */
  @Test
  void parsesRealGeneratedShapes() throws IOException {
    json("/help/manual-index.json", resource("help/manual-index.json"));
    json("/help/manual/introduction.json", resource("help/manual/introduction.json"));
    json("/help/manual/agents.json", resource("help/manual/agents.json"));

    HelpBundle b = source().fetch();

    assertThat(b.chapters())
        .extracting(HelpBundle.Chapter::chapter)
        .containsExactly("introduction", "agents");
    HelpBundle.Chapter agents = b.chapters().get(1);
    assertThat(agents.audience()).containsExactly("admin");
    assertThat(agents.sections()).hasSize(2);
    assertThat(agents.sections().get(0).id()).isEqualTo("agents#_intro");
    assertThat(agents.sections().get(0).markdown()).isNotBlank();
  }

  /** 절의 parent·그림(표식)·링크를 읽는다(WP-1510) — 그림 src·표식 key·level 같은 쓰지 않는 필드는 무시. */
  @Test
  void parsesParentFiguresAndLinks() throws IOException {
    json("/help/manual-index.json", "[{\"chapter\":\"home\",\"title\":\"홈\",\"audience\":[]}]");
    json(
        "/help/manual/home.json",
        "{\"sections\":[{\"id\":\"home#고르기\",\"label\":\"고르기\",\"title\":\"고르기\","
            + "\"parent\":\"home.widget\",\"level\":3,\"markdown\":\"![화면](figure:home-3)\","
            + "\"figures\":[{\"id\":\"home-3\",\"src\":\"figures/home-3.png\",\"alt\":\"화면\","
            + "\"marks\":[{\"n\":1,\"label\":\"추가\",\"key\":\"add\"}]}],"
            + "\"links\":[\"home.widget\"]}]}");

    HelpBundle.Section s = source().fetch().chapters().get(0).sections().get(0);

    assertThat(s.parent()).isEqualTo("home.widget");
    assertThat(s.links()).containsExactly("home.widget");
    assertThat(s.figures())
        .containsExactly(
            new HelpBundle.Figure("home-3", "화면", java.util.List.of(new HelpBundle.Mark(1, "추가"))));
  }

  private static String resource(String path) throws IOException {
    try (var in = HttpHelpBundleSourceTest.class.getClassLoader().getResourceAsStream(path)) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }
}
