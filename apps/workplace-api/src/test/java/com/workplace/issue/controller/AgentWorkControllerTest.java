package com.workplace.issue.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.AgentWorkTestSupport;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;

/** AI 작업 명시 보고 API(WP-377 §4.1) — PAT·ak_ 로 실제 HTTP 요청을 보내 검증한다. */
class AgentWorkControllerTest extends AgentWorkTestSupport {

  @Test
  void 첫_보고는_생성하고_TODO_를_IN_PROGRESS_로() {
    var r = putReport(patToken, TOOL, Map.of("note", "시작"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    assertThat(json(r).at("/work/state").asText()).isEqualTo("WORKING");
    assertThat(json(r).at("/ended").asBoolean()).isFalse();
  }

  @Test
  void TODO_이슈에_INPUT_REQUIRED_과_message_보고하면_최종_INPUT_REQUIRED() {
    putReport(
        patToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "A안/B안 중 무엇으로 할까요?\n세부…"));
    var w = activeWork(issueId, humanId).orElseThrow();
    assertThat(w.state()).isEqualTo("INPUT_REQUIRED");
    assertThat(w.note()).isEqualTo("A안/B안 중 무엇으로 할까요?");
  }

  @Test
  void 상태미지정_보고가_TODO_전환의_자동터치로_기존_INPUT_REQUIRED_을_되돌리지_않음() {
    // 이슈는 TODO, 작업은 이미 INPUT_REQUIRED — 보고가 TODO→IN_PROGRESS 를 일으켜도 억제 구간이라 INPUT_REQUIRED 유지.
    seedActive(issueId, humanId, "INPUT_REQUIRED");
    putReport(patToken, TOOL, Map.of("note", "메모만"));
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("INPUT_REQUIRED");
  }

  @Test
  void message_는_이슈챗에_호출자_이름으로_AI구성원_INPUT_REQUIRED_이면_질문표시() {
    var r = putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "질문"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    var m = lastChatMessage(issueId);
    assertThat(m.authorId()).isEqualTo(agentId);
    assertThat(m.isQuestion()).isTrue();
  }

  @Test
  void 사람_INPUT_REQUIRED_message_는_질문표시_안함() {
    putReport(patToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "질문"));
    var m = lastChatMessage(issueId);
    assertThat(m.authorId()).isEqualTo(humanId);
    assertThat(m.isQuestion()).isFalse();
  }

  @Test
  void 사람이_챗에_답하면_AI구성원_INPUT_REQUIRED_이_WORKING() {
    putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "질문"));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("INPUT_REQUIRED");
    var r = postChat(jwtToken, "B안으로");
    assertThat(r.getStatusCode().is2xxSuccessful()).as(r.getBody()).isTrue();
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
  }

  @Test
  void 종료상태_보고는_그_상태로_종료_이슈상태_불변_없으면_200() {
    putReport(patToken, TOOL, Map.of("note", "시작"));
    // 시작 보고가 TODO → IN_PROGRESS 로 바꿨으므로 종료 후에도 그대로여야 한다.
    var r = putReport(patToken, TOOL, Map.of("state", "COMPLETED"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(json(r).at("/ended").asBoolean()).isTrue();
    assertThat(json(r).at("/work").isNull()).isTrue();
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(allStates(issueId, humanId)).containsExactly("COMPLETED");
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    // 진행 중 작업이 없어도 200.
    var again = putReport(patToken, TOOL, Map.of("state", "COMPLETED"));
    assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(json(again).at("/ended").asBoolean()).isTrue();
  }

  /** 종료 4종은 각각 그 상태로 행을 닫고, message 를 먼저 챗에 올리며(질문 표시 없음), 이슈 상태를 올리지 않는다. */
  @ParameterizedTest
  @ValueSource(strings = {"COMPLETED", "FAILED", "CANCELED", "REJECTED"})
  void 종료상태_보고는_message_를_올리고_그_상태로_종료_TODO_는_그대로(String terminal) {
    // 진행 중 작업을 시드로 만들어 TODO 이슈 상태를 건드리지 않은 채 종료 보고만 한다.
    seedActive(issueId, agentId, "WORKING");
    var r = putReport(akToken, TOOL, Map.of("state", terminal, "message", terminal + " 사유"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(json(r).at("/ended").asBoolean()).isTrue();
    var m = lastChatMessage(issueId);
    assertThat(m.authorId()).isEqualTo(agentId);
    assertThat(m.body()).isEqualTo(terminal + " 사유");
    assertThat(m.isQuestion()).isFalse();
    assertThat(activeWork(issueId, agentId)).isEmpty();
    assertThat(allStates(issueId, agentId)).containsExactly(terminal);
    assertThat(eventStates(issueId, agentId)).endsWith(terminal);
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  @Test
  void 종료상태_보고는_message_없이도_종료() {
    putReport(akToken, TOOL, Map.of("note", "시작"));
    var r = putReport(akToken, TOOL, Map.of("state", "REJECTED"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(allStates(issueId, agentId)).containsExactly("REJECTED");
  }

  /** AUTH_REQUIRED 는 진행 중 중단 상태 — 질문이 아니라 일반 글이고, 사람 글이 와도 WORKING 으로 풀리지 않는다. */
  @Test
  void AUTH_REQUIRED_보고는_질문표시_없고_사람_답으로_재개되지_않음() {
    putReport(akToken, TOOL, Map.of("state", "AUTH_REQUIRED", "message", "토큰이 필요합니다"));
    assertThat(lastChatMessage(issueId).isQuestion()).isFalse();
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("AUTH_REQUIRED");
    assertOk(postChat(jwtToken, "토큰 드렸어요"));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("AUTH_REQUIRED");
  }

  /** AUTH_REQUIRED 에서 note 없이 WORKING 으로 보고하면 요청 note 를 지운다. */
  @Test
  void AUTH_REQUIRED_에서_note없이_WORKING_이면_note_지움() {
    putReport(akToken, TOOL, Map.of("state", "AUTH_REQUIRED", "note", "토큰 필요"));
    putReport(akToken, TOOL, Map.of("state", "WORKING"));
    var w = activeWork(issueId, agentId).orElseThrow();
    assertThat(w.state()).isEqualTo("WORKING");
    assertThat(w.note()).isNull();
  }

  @Test
  void 구_상태명_WAITING_은_받지_않음() {
    assertThat(putReport(patToken, TOOL, Map.of("state", "WAITING")).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void message_첫줄_note_는_서로게이트_쌍을_쪼개지_않음() {
    // 119자 + 이모지(UTF-16 2칸)가 120 경계에 걸린다.
    String msg = "가".repeat(119) + "😀뒤";
    putReport(patToken, TOOL, Map.of("message", msg));
    String note = activeWork(issueId, humanId).orElseThrow().note();
    assertThat(note).isEqualTo("가".repeat(119));
  }

  @Test
  void 처음부터_종료상태면_이슈상태_TODO_그대로() {
    var r = putReport(patToken, TOOL, Map.of("state", "FAILED"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(issueStatus()).isEqualTo("TODO");
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void note_빈문자열은_지움() {
    putReport(patToken, TOOL, Map.of("note", "a"));
    assertThat(activeWork(issueId, humanId).orElseThrow().note()).isEqualTo("a");
    putReport(patToken, TOOL, Map.of("note", ""));
    assertThat(activeWork(issueId, humanId).orElseThrow().note()).isNull();
  }

  @Test
  void 담당자_아니면_403() {
    assertThat(putReport(otherPatToken, TOOL, Map.of()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  void 완료_이슈면_409() {
    patch(jwtToken, Map.of("status", "DONE"), null);
    assertThat(putReport(patToken, TOOL, Map.of()).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  void 헤더없으면_400() {
    assertThat(putReport(patToken, null, Map.of()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void 검증_400() {
    assertThat(putReport(patToken, TOOL, Map.of("progress", 101)).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(putReport(patToken, TOOL, Map.of("stepsDone", 6, "stepsTotal", 5)).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(putReport(patToken, TOOL, Map.of("stepsDone", 2)).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(putReport(patToken, TOOL, Map.of("note", "가".repeat(121))).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(putReport(patToken, TOOL, Map.of("state", "NOPE")).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void 담당자_여럿이_동시에_각자_작업() {
    putReport(patToken, TOOL, Map.of("note", "사람"));
    putReport(akToken, TOOL, Map.of("note", "AI"));
    assertThat(activeCount(issueId)).isEqualTo(2);
  }
}
