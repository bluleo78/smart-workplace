package com.workplace.issue.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.AgentWorkTestSupport;
import java.util.Map;
import org.junit.jupiter.api.Test;
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
  void TODO_이슈에_WAITING_과_message_보고하면_최종_WAITING() {
    putReport(patToken, TOOL, Map.of("state", "WAITING", "message", "A안/B안 중 무엇으로 할까요?\n세부…"));
    var w = activeWork(issueId, humanId).orElseThrow();
    assertThat(w.state()).isEqualTo("WAITING");
    assertThat(w.note()).isEqualTo("A안/B안 중 무엇으로 할까요?");
  }

  @Test
  void 상태미지정_보고가_TODO_전환의_자동터치로_기존_WAITING_을_되돌리지_않음() {
    // 이슈는 TODO, 작업은 이미 WAITING — 보고가 TODO→IN_PROGRESS 를 일으켜도 억제 구간이라 WAITING 유지.
    seedActive(issueId, humanId, "WAITING");
    putReport(patToken, TOOL, Map.of("note", "메모만"));
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WAITING");
  }

  @Test
  void message_는_이슈챗에_호출자_이름으로_AI구성원_WAITING_이면_질문표시() {
    var r = putReport(akToken, TOOL, Map.of("state", "WAITING", "message", "질문"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    var m = lastChatMessage(issueId);
    assertThat(m.authorId()).isEqualTo(agentId);
    assertThat(m.isQuestion()).isTrue();
  }

  @Test
  void 사람_WAITING_message_는_질문표시_안함() {
    putReport(patToken, TOOL, Map.of("state", "WAITING", "message", "질문"));
    var m = lastChatMessage(issueId);
    assertThat(m.authorId()).isEqualTo(humanId);
    assertThat(m.isQuestion()).isFalse();
  }

  @Test
  void 사람이_챗에_답하면_AI구성원_WAITING_이_WORKING() {
    putReport(akToken, TOOL, Map.of("state", "WAITING", "message", "질문"));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("WAITING");
    var r = postChat(jwtToken, "B안으로");
    assertThat(r.getStatusCode().is2xxSuccessful()).as(r.getBody()).isTrue();
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
  }

  @Test
  void ENDED_는_종료_이슈상태_불변_없으면_200() {
    putReport(patToken, TOOL, Map.of("note", "시작"));
    // 시작 보고가 TODO → IN_PROGRESS 로 바꿨으므로 종료 후에도 그대로여야 한다.
    var r = putReport(patToken, TOOL, Map.of("state", "ENDED"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(json(r).at("/ended").asBoolean()).isTrue();
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    // 진행 중 작업이 없어도 200.
    var again = putReport(patToken, TOOL, Map.of("state", "ENDED"));
    assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(json(again).at("/ended").asBoolean()).isTrue();
  }

  @Test
  void ENDED_와_message_는_챗에_올리고_작업을_종료() {
    putReport(akToken, TOOL, Map.of("note", "시작"));
    var r = putReport(akToken, TOOL, Map.of("state", "ENDED", "message", "마쳤습니다"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(json(r).at("/ended").asBoolean()).isTrue();
    var m = lastChatMessage(issueId);
    assertThat(m.authorId()).isEqualTo(agentId);
    assertThat(m.body()).isEqualTo("마쳤습니다");
    assertThat(m.isQuestion()).isFalse();
    assertThat(activeWork(issueId, agentId)).isEmpty();
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
  void 처음부터_ENDED_면_이슈상태_TODO_그대로() {
    var r = putReport(patToken, TOOL, Map.of("state", "ENDED"));
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
