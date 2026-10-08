package com.workplace.wiki.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.wiki.exception.CollabBodyRejectedException;
import com.workplace.wiki.exception.CollabMergeFailedException;
import com.workplace.wiki.exception.CollabRequestRejectedException;
import com.workplace.wiki.exception.CollabUnavailableException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.CollabClient.MergeBase;
import java.io.IOException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * CollabClient 의 동기화 서버 응답 → API 예외 매핑. 페이지가 없어진 것(404·410)은 일시 장애(503)가 아니라 not-found(404) 여야 호출자가
 * 재시도하지 않고, 400(본문 거부 — 빈 본문·해석 불가)은 호출자 오류라 400, 그 밖의 4xx 는 서버 버그라 500, 병합 계산 실패(500)는 502, 503 은
 * 연결 실패·타임아웃·그 밖의 5xx 에만 남긴다(WP-289 Task 2 계약).
 */
class CollabClientTest {
  private static final String URL = "http://collab.test/internal/docs/7/apply-markdown";

  private MockRestServiceServer server;
  private CollabClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://collab.test");
    // CollabClient 생성자가 build() 하므로 목 서버를 먼저 묶는다.
    server = MockRestServiceServer.bindTo(builder).build();
    client = new CollabClient(builder, "tok");
  }

  private void apply() {
    client.applyMarkdown(1L, 7L, new MergeBase("기준", null), "본문", 3L, "협업자", false, false);
  }

  @Test
  void 성공_응답을_파싱한다() {
    server
        .expect(requestTo(URL))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess("{\"version\":4,\"body\":\"본문\"}", MediaType.APPLICATION_JSON));
    var res =
        client.applyMarkdown(1L, 7L, new MergeBase("기준", null), "본문", 3L, "협업자", false, false);
    assertThat(res.version()).isEqualTo(4);
    server.verify();
  }

  /** persisted 키 — false 면 적용됐지만 저장 전, 키가 없으면(구버전 동기화 서버) 저장된 것으로 본다. */
  @Test
  void persisted_키를_읽고_없으면_저장된_것으로_본다() {
    server
        .expect(requestTo(URL))
        .andRespond(
            withSuccess(
                "{\"version\":4,\"body\":\"본문\",\"persisted\":false}", MediaType.APPLICATION_JSON));
    server
        .expect(requestTo(URL))
        .andRespond(withSuccess("{\"version\":4,\"body\":\"본문\"}", MediaType.APPLICATION_JSON));
    assertThat(
            client
                .applyMarkdown(1L, 7L, new MergeBase("기준", null), "본문", 3L, "협업자", true, true)
                .isPersisted())
        .isFalse();
    assertThat(
            client
                .applyMarkdown(1L, 7L, new MergeBase("기준", null), "본문", 3L, "협업자", true, true)
                .isPersisted())
        .isTrue();
  }

  @Test
  void 동기화_서버_404는_페이지_없음이다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.NOT_FOUND));
    assertThatThrownBy(this::apply).isInstanceOf(WikiPageNotFoundException.class);
  }

  @Test
  void 동기화_서버_410도_페이지_없음이다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.GONE));
    assertThatThrownBy(this::apply).isInstanceOf(WikiPageNotFoundException.class);
  }

  /** 400 + 본문 거부 코드(빈 AI 본문) → 400. 문구는 깔끔한 한국어 — 동기화 서버의 원시 JSON 을 공개 메시지에 싣지 않는다. */
  @Test
  void 본문_거부_코드의_400은_본문_거부_400이고_원시_JSON을_싣지_않는다() {
    server
        .expect(requestTo(URL))
        .andRespond(
            withStatus(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"empty body: refusing\",\"code\":\"empty_body\"}"));
    assertThatThrownBy(this::apply)
        .isInstanceOf(CollabBodyRejectedException.class)
        .hasMessageContaining("빈 본문")
        .hasMessageNotContaining("{")
        .hasMessageNotContaining("refusing");
  }

  @Test
  void 해석_불가_코드의_400도_본문_거부_400이다() {
    server
        .expect(requestTo(URL))
        .andRespond(
            withStatus(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"unparseable body: x\",\"code\":\"unparseable_body\"}"));
    assertThatThrownBy(this::apply)
        .isInstanceOf(CollabBodyRejectedException.class)
        .hasMessageNotContaining("{");
  }

  /** 우리 계약 위반(잘못된 tenantId·mode 등) 400 은 호출자 잘못이 아니다 — 서버 버그로 500. */
  @Test
  void 계약_위반_코드의_400은_요청_거부_500이다() {
    server
        .expect(requestTo(URL))
        .andRespond(
            withStatus(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"invalid tenantId\",\"code\":\"invalid_request\"}"));
    assertThatThrownBy(this::apply)
        .isInstanceOf(CollabRequestRejectedException.class)
        .isNotInstanceOf(CollabBodyRejectedException.class);
  }

  /** 코드가 없거나 JSON 이 아닌 400 도 본문 거부로 보지 않는다(500). */
  @Test
  void 코드_없는_400은_요청_거부_500이다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.BAD_REQUEST).body("not json"));
    assertThatThrownBy(this::apply).isInstanceOf(CollabRequestRejectedException.class);
  }

  @Test
  void 그_밖의_4xx는_일시_장애가_아니라_요청_거부다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
    assertThatThrownBy(this::apply)
        .isInstanceOf(CollabRequestRejectedException.class)
        .isNotInstanceOf(CollabUnavailableException.class);
  }

  @Test
  void 동기화_서버_500은_병합_실패_502다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));
    assertThatThrownBy(this::apply)
        .isInstanceOf(CollabMergeFailedException.class)
        .isNotInstanceOf(CollabUnavailableException.class);
  }

  @Test
  void 기준본이_있으면_merge_로_보내고_제출본은_altBaseBody_로_싣는다() {
    server
        .expect(requestTo(URL))
        .andExpect(jsonPath("$.mode").value("merge"))
        .andExpect(jsonPath("$.baseBody").value("기준"))
        .andExpect(jsonPath("$.altBaseBody").value("제출본"))
        .andExpect(jsonPath("$.body").value("본문"))
        .andRespond(withSuccess("{\"version\":4,\"body\":\"본문\"}", MediaType.APPLICATION_JSON));
    client.applyMarkdown(1L, 7L, new MergeBase("기준", "제출본"), "본문", 3L, "협업자", true, true);
    server.verify();
  }

  @Test
  void 제출본이_없으면_altBaseBody_키를_생략한다() {
    server
        .expect(requestTo(URL))
        .andExpect(jsonPath("$.mode").value("merge"))
        .andExpect(jsonPath("$.altBaseBody").doesNotExist())
        .andRespond(withSuccess("{\"version\":4,\"body\":\"본문\"}", MediaType.APPLICATION_JSON));
    client.applyMarkdown(1L, 7L, new MergeBase("기준", null), "본문", 3L, "협업자", true, true);
    server.verify();
  }

  /** snapshot 은 ai 와 따로 싣는다 — 사람(구버전 웹)의 명시 스냅샷 요청도 동기화 서버 저장이 리비전을 남기게. */
  @Test
  void snapshot_플래그를_싣는다() {
    server
        .expect(requestTo(URL))
        .andExpect(jsonPath("$.ai").value(false))
        .andExpect(jsonPath("$.snapshot").value(true))
        .andRespond(withSuccess("{\"version\":4,\"body\":\"본문\"}", MediaType.APPLICATION_JSON));
    client.applyMarkdown(1L, 7L, new MergeBase("기준", null), "본문", 3L, "협업자", false, true);
    server.verify();
  }

  @Test
  void 서버_5xx는_일시_장애_503이다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
    assertThatThrownBy(this::apply).isInstanceOf(CollabUnavailableException.class);
  }

  @Test
  void 연결_실패는_일시_장애_503이다() {
    server.expect(requestTo(URL)).andRespond(withException(new IOException("connection refused")));
    assertThatThrownBy(this::apply).isInstanceOf(CollabUnavailableException.class);
  }
}
