package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.AgentWorkTestSupport;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jooq.JSONB;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

/**
 * AI 질문 답 선택지(WP-1569) — report_agent_work 의 options 가 정리(공백·빈 값·중복 제거)돼 질문 글에 저장되고 메시지 목록 응답에
 * 실리는지, 질문이 아니거나 개수·길이가 맞지 않으면 400 으로 보고 전체가 거절되는지 실제 HTTP 로 검증한다.
 */
class AgentWorkReportOptionsTest extends AgentWorkTestSupport {

  private static final ObjectMapper OM = new ObjectMapper();

  @Test
  void 질문_보고의_options_는_정리돼_질문_글에_저장되고_목록_응답에_실린다() {
    var r =
        putReport(
            akToken,
            TOOL,
            Map.of(
                "state",
                "INPUT_REQUIRED",
                "message",
                "A안과 B안 중 무엇으로 할까요? 추천은 A안입니다.",
                "options",
                List.of("  A안으로 ", "B안으로", "A안으로", "")));

    assertOk(r);
    var m = lastChatMessage(issueId);
    assertThat(m.isQuestion()).isTrue();
    assertThat(storedOptions(m.id())).containsExactly("A안으로", "B안으로");
    // 사람이 보는 메시지 목록에도 같은 순서로 실린다(추천이 첫 번째).
    JsonNode item = lastListItem();
    assertThat(item.get("options").isArray()).isTrue();
    assertThat(texts(item.get("options"))).containsExactly("A안으로", "B안으로");
  }

  @Test
  void options_없는_일반_글은_목록_응답의_options_가_null() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "진행 중이에요")));

    assertThat(storedOptions(lastChatMessage(issueId).id())).isNull();
    assertThat(lastListItem().get("options").isNull()).isTrue();
  }

  @Test
  void 사람_작업자의_INPUT_REQUIRED_보고는_질문이_아니라_options_를_저장하지_않는다() {
    assertOk(
        putReport(
            patToken,
            TOOL,
            Map.of("state", "INPUT_REQUIRED", "message", "어느 쪽?", "options", List.of("가", "나"))));

    var m = lastChatMessage(issueId);
    assertThat(m.isQuestion()).isFalse();
    assertThat(storedOptions(m.id())).isNull();
  }

  @Test
  void state_가_INPUT_REQUIRED_가_아니면_400_이고_글이_남지_않는다() {
    assertBadRequest(Map.of("state", "WAITING", "message", "기다려요", "options", List.of("가", "나")));
  }

  @Test
  void state_없이_options_만_오면_400() {
    assertBadRequest(Map.of("message", "보고", "options", List.of("가", "나")));
  }

  @Test
  void message_없이_options_가_오면_400() {
    assertBadRequest(Map.of("state", "INPUT_REQUIRED", "options", List.of("가", "나")));
  }

  @Test
  void 정리_뒤_1개면_400() {
    assertBadRequest(question(List.of("가", " 가 ", "  ")));
  }

  @Test
  void 다섯_개면_400() {
    assertBadRequest(question(List.of("1", "2", "3", "4", "5")));
  }

  @Test
  void 마흔한_자면_400() {
    assertBadRequest(question(List.of("가".repeat(41), "나")));
  }

  @Test
  void 중복을_빼면_4개인_다섯_개는_통과한다() {
    assertOk(putReport(akToken, TOOL, question(List.of("1", "2", "3", "4", " 1"))));

    assertThat(storedOptions(lastChatMessage(issueId).id())).containsExactly("1", "2", "3", "4");
  }

  /** 질문 보고 본문. */
  private static Map<String, Object> question(List<String> options) {
    return Map.of("state", "INPUT_REQUIRED", "message", "어느 쪽으로 할까요?", "options", options);
  }

  /** 400 이고 작업 상태·챗 글이 남지 않았는지 — 검증은 보고 처리 전에 끝난다. */
  private void assertBadRequest(Map<String, ?> body) {
    var r = putReport(akToken, TOOL, body);

    assertThat(r.getStatusCode()).as(r.getBody()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(activeWork(issueId, agentId)).isEmpty();
    assertThat(lastChatMessageOrNull(issueId)).isNull();
  }

  /** 저장된 options(JSON 문자열 배열) — NULL 이면 null. */
  private List<String> storedOptions(long messageId) {
    JSONB raw =
        inTenant(
            () ->
                dsl.select(CHAT_MESSAGE.OPTIONS)
                    .from(CHAT_MESSAGE)
                    .where(CHAT_MESSAGE.ID.eq(messageId))
                    .fetchOne(CHAT_MESSAGE.OPTIONS));
    if (raw == null) return null;
    try {
      return texts(OM.readTree(raw.data()));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  /** 사람 JWT 로 본 메시지 목록의 마지막(가장 최근) 글. */
  private JsonNode lastListItem() {
    JsonNode items =
        json(call(
                HttpMethod.GET,
                "/api/v1/chat/threads/" + chatThreadId() + "/messages",
                jwtToken,
                null,
                null))
            .get("items");
    assertThat(items.size()).isPositive();
    // cursor 모드는 최신순 — 첫 항목이 가장 최근 글이다.
    return items.get(0);
  }

  private static List<String> texts(JsonNode array) {
    List<String> out = new ArrayList<>();
    array.forEach(n -> out.add(n.asText()));
    return out;
  }
}
