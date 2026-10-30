package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.AgentWorkTestSupport;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
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

  // WP-1217: 사람에게 묻거나 사람의 답을 기다리면 언제나 답변 필요 — AI 가 사람을 멘션한 대기 중 보고는 서버가 답변 필요로 바꿔 저장한다.

  @Test
  void AI가_사람을_멘션한_대기중_보고는_답변필요_질문으로_저장하고_바꾼_사실을_알린다() {
    var r =
        putReport(
            akToken,
            TOOL,
            Map.of("state", "WAITING", "message", "<@" + humanId + "> 2번 UX 를 정해 주세요"));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(json(r).at("/work/state").asText()).isEqualTo("INPUT_REQUIRED");
    assertThat(json(r).at("/coercedFrom").asText()).isEqualTo("WAITING");
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("INPUT_REQUIRED");
    assertThat(lastChatMessage(issueId).isQuestion()).isTrue();
  }

  @Test
  void AI만_멘션한_대기중_보고는_그대로_대기중() {
    // 검토자 AI 에게 리뷰를 맡기는 경우 — 시드의 AI 구성원(agent)을 멘션한다.
    var r =
        putReport(
            akToken,
            TOOL,
            Map.of("state", "WAITING", "message", "<@" + agentId + "> PR 검토 부탁드립니다"));
    assertThat(json(r).at("/work/state").asText()).isEqualTo("WAITING");
    assertThat(json(r).at("/coercedFrom").isNull()).isTrue();
    assertThat(lastChatMessage(issueId).isQuestion()).isFalse();
  }

  @Test
  void 멘션_없는_대기중_보고는_그대로_대기중() {
    var r = putReport(akToken, TOOL, Map.of("state", "WAITING", "message", "다른 AI 의 답을 기다립니다"));
    assertThat(json(r).at("/work/state").asText()).isEqualTo("WAITING");
    assertThat(json(r).at("/coercedFrom").isNull()).isTrue();
  }

  @Test
  void 사람_작업자의_대기중_보고는_사람을_멘션해도_그대로() {
    var r =
        putReport(
            patToken, TOOL, Map.of("state", "WAITING", "message", "<@" + otherId + "> 확인 부탁"));
    assertThat(json(r).at("/work/state").asText()).isEqualTo("WAITING");
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WAITING");
  }

  @Test
  void AI의_작업중_보고는_사람을_멘션해도_그대로() {
    // 작업 중 글의 사람 멘션은 질문인지 알림인지 서버가 가릴 수 없어 손대지 않는다(스킬 규칙이 막는다).
    var r =
        putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "<@" + humanId + "> 머지했어요"));
    assertThat(json(r).at("/work/state").asText()).isEqualTo("WORKING");
    assertThat(lastChatMessage(issueId).isQuestion()).isFalse();
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

  /** 종료 보고에 담긴 마지막 note·단계 수가 작업 행과 종료 이벤트(하나뿐)에 최종 값으로 남는다. */
  @Test
  void 종료상태_보고의_note_와_단계수가_행과_종료_이벤트에_반영() {
    putReport(akToken, TOOL, Map.of("note", "작업 중", "stepsDone", 2, "stepsTotal", 3));
    int before = eventCount();
    var r =
        putReport(
            akToken,
            TOOL,
            Map.of("state", "COMPLETED", "note", "모두 끝", "stepsDone", 3, "stepsTotal", 3));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    var row = lastWork();
    assertThat(row.state()).isEqualTo("COMPLETED");
    assertThat(row.note()).isEqualTo("모두 끝");
    assertThat(row.stepsDone()).isEqualTo((short) 3);
    assertThat(row.stepsTotal()).isEqualTo((short) 3);
    // 종료 보고 한 번에 이벤트도 정확히 하나, 최종 값을 담는다.
    assertThat(eventCount()).isEqualTo(before + 1);
    var ev = lastEvent();
    assertThat(ev.state()).isEqualTo("COMPLETED");
    assertThat(ev.note()).isEqualTo("모두 끝");
    assertThat(ev.stepsDone()).isEqualTo((short) 3);
    assertThat(ev.stepsTotal()).isEqualTo((short) 3);
  }

  /** note 미지정 + message 면 일반 보고처럼 message 첫 줄이 note 가 되고, progress 도 반영한다. */
  @Test
  void 종료상태_보고도_note_미지정이면_message_첫줄을_note_로() {
    putReport(akToken, TOOL, Map.of("note", "작업 중"));
    putReport(
        akToken, TOOL, Map.of("state", "COMPLETED", "message", "마무리했습니다\n세부 설명", "progress", 100));
    var row = lastWork();
    assertThat(row.note()).isEqualTo("마무리했습니다");
    assertThat(row.progress()).isEqualTo((short) 100);
    assertThat(lastEvent().note()).isEqualTo("마무리했습니다");
  }

  /** note 미지정이면 message 첫 줄이 note 가 되는데, 멘션 토큰(<@id>)은 @이름으로 바꿔 숫자 id 가 note 에 남지 않는다(WP-1009). */
  @Test
  void note_미지정_message_첫줄의_멘션_토큰은_이름으로() {
    putReport(
        akToken,
        TOOL,
        Map.of("state", "REVIEW", "message", "<@" + humanId + "> 검토 부탁해요 <@999999999>\n세부"));
    assertThat(lastWork().note()).isEqualTo("@aw-human 검토 부탁해요 @사용자");
  }

  /** note 빈 문자열은 일반 보고처럼 지운다. */
  @Test
  void 종료상태_보고의_빈_note_는_note_를_지움() {
    putReport(akToken, TOOL, Map.of("note", "작업 중"));
    putReport(akToken, TOOL, Map.of("state", "FAILED", "note", ""));
    assertThat(lastWork().note()).isNull();
    assertThat(lastEvent().note()).isNull();
  }

  /** 종료 보고가 note·진행률·단계 수를 보내지 않으면 직전 값이 그대로이고 이벤트는 하나만 는다. */
  @Test
  void 종료상태_보고에_값이_없으면_직전_값_유지() {
    putReport(
        akToken, TOOL, Map.of("note", "작업 중", "progress", 60, "stepsDone", 2, "stepsTotal", 3));
    int before = eventCount();
    assertOk(putReport(akToken, TOOL, Map.of("state", "CANCELED")));
    var row = lastWork();
    assertThat(row.state()).isEqualTo("CANCELED");
    assertThat(row.note()).isEqualTo("작업 중");
    assertThat(row.progress()).isEqualTo((short) 60);
    assertThat(row.stepsDone()).isEqualTo((short) 2);
    assertThat(row.stepsTotal()).isEqualTo((short) 3);
    assertThat(eventCount()).isEqualTo(before + 1);
    var ev = lastEvent();
    assertThat(ev.note()).isEqualTo("작업 중");
    assertThat(ev.stepsDone()).isEqualTo((short) 2);
  }

  /** 시작 전(SUBMITTED)에서 곧바로 종료 보고해도 보고의 note·단계 수가 담긴다. */
  @Test
  void 시작전_행에서_바로_종료_보고해도_값이_반영() {
    seedSubmitted(issueId, agentId);
    assertOk(
        putReport(
            akToken,
            TOOL,
            Map.of("state", "COMPLETED", "note", "바로 끝", "stepsDone", 1, "stepsTotal", 1)));
    var row = lastWork();
    assertThat(row.state()).isEqualTo("COMPLETED");
    assertThat(row.tool()).isEqualTo(TOOL);
    assertThat(row.note()).isEqualTo("바로 끝");
    assertThat(row.stepsTotal()).isEqualTo((short) 1);
    assertThat(lastEvent().note()).isEqualTo("바로 끝");
  }

  /** 작업 행·이벤트에서 검증에 필요한 값만 담는 조회 결과. */
  private record Snapshot(
      String state, String note, Short progress, Short stepsDone, Short stepsTotal, String tool) {}

  /** (이슈, AI 구성원)의 가장 최근 작업 행. */
  private Snapshot lastWork() {
    return inTenant(
        () ->
            dsl.select(
                    AGENT_WORK.STATE,
                    AGENT_WORK.NOTE,
                    AGENT_WORK.PROGRESS,
                    AGENT_WORK.STEPS_DONE,
                    AGENT_WORK.STEPS_TOTAL,
                    AGENT_WORK.TOOL)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                .and(AGENT_WORK.WORKER_ID.eq(agentId))
                .orderBy(AGENT_WORK.ID.desc())
                .limit(1)
                .fetchOne(
                    r ->
                        new Snapshot(
                            r.get(AGENT_WORK.STATE),
                            r.get(AGENT_WORK.NOTE),
                            r.get(AGENT_WORK.PROGRESS),
                            r.get(AGENT_WORK.STEPS_DONE),
                            r.get(AGENT_WORK.STEPS_TOTAL),
                            r.get(AGENT_WORK.TOOL))));
  }

  /** (이슈, AI 구성원)의 마지막 이벤트. */
  private Snapshot lastEvent() {
    return inTenant(
        () ->
            dsl.select(
                    AGENT_WORK_EVENT.STATE,
                    AGENT_WORK_EVENT.NOTE,
                    AGENT_WORK_EVENT.PROGRESS,
                    AGENT_WORK_EVENT.STEPS_DONE,
                    AGENT_WORK_EVENT.STEPS_TOTAL)
                .from(AGENT_WORK_EVENT)
                .join(AGENT_WORK)
                .on(AGENT_WORK.ID.eq(AGENT_WORK_EVENT.WORK_ID))
                .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                .and(AGENT_WORK.WORKER_ID.eq(agentId))
                .orderBy(AGENT_WORK_EVENT.ID.desc())
                .limit(1)
                .fetchOne(
                    r ->
                        new Snapshot(
                            r.get(AGENT_WORK_EVENT.STATE),
                            r.get(AGENT_WORK_EVENT.NOTE),
                            r.get(AGENT_WORK_EVENT.PROGRESS),
                            r.get(AGENT_WORK_EVENT.STEPS_DONE),
                            r.get(AGENT_WORK_EVENT.STEPS_TOTAL),
                            null)));
  }

  /** (이슈, AI 구성원)의 이벤트 수. */
  private int eventCount() {
    return eventStates(issueId, agentId).size();
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

  /**
   * 모르는 상태는 거절한다 — WP-377 때 없앤 옛 이름 ENDED 로 확인한다. 같은 때 없앤 옛 WAITING(지금의 INPUT_REQUIRED)은 배포된 적이 없어
   * WP-1024 에서 「대기 중」으로 다시 쓴다.
   */
  @Test
  void unknownState_rejected_legacyEnded() {
    assertThat(putReport(patToken, TOOL, Map.of("state", "ENDED")).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  /** WP-1024: 대기 중(WAITING) 보고를 받고 note 를 남긴다. */
  @Test
  void waiting_accepted_withNote() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "WAITING", "note", "PR #12 리뷰 — AI 팀장")));
    var w = activeWork(issueId, agentId).orElseThrow();
    assertThat(w.state()).isEqualTo("WAITING");
    assertThat(w.note()).isEqualTo("PR #12 리뷰 — AI 팀장");
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

  // ---------------------------------------------------------------- 다음 회차 대기(WP-450)

  private static final String NEXT_RUN = "2026-10-19T09:00:00+09:00";
  private static final Instant NEXT_RUN_INSTANT = OffsetDateTime.parse(NEXT_RUN).toInstant();

  @Test
  void nextRunAt_은_SCHEDULED_일_때만_받는다_그_외는_400() {
    for (String state : new String[] {"WORKING", "REVIEW", "COMPLETED"}) {
      assertThat(
              putReport(patToken, TOOL, Map.of("state", state, "nextRunAt", NEXT_RUN))
                  .getStatusCode())
          .as(state)
          .isEqualTo(HttpStatus.BAD_REQUEST);
    }
    // 상태 미지정 + nextRunAt 도 어느 상태의 시각인지 모호해 거절.
    assertThat(putReport(patToken, TOOL, Map.of("nextRunAt", NEXT_RUN)).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void SCHEDULED_는_시각_없이도_보고되고_시각이_있으면_저장되어_응답에_왕복() {
    var none = putReport(patToken, TOOL, Map.of("state", "SCHEDULED"));
    assertThat(none.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(json(none).at("/work/state").asText()).isEqualTo("SCHEDULED");
    assertThat(json(none).at("/work").has("nextRunAt")).isFalse();

    var r = putReport(patToken, TOOL, Map.of("state", "SCHEDULED", "nextRunAt", NEXT_RUN));
    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(activeWork(issueId, humanId).orElseThrow().nextRunAt()).isEqualTo(NEXT_RUN_INSTANT);
    // 응답은 Instant(UTC) 로 나간다 — 같은 시점이다.
    assertThat(Instant.parse(json(r).at("/work/nextRunAt").asText())).isEqualTo(NEXT_RUN_INSTANT);
  }

  @Test
  void SCHEDULED_보고는_시각을_그대로_덮고_null_이면_비운다() {
    putReport(patToken, TOOL, Map.of("state", "SCHEDULED", "nextRunAt", NEXT_RUN));
    putReport(patToken, TOOL, Map.of("state", "SCHEDULED", "nextRunAt", "2026-10-20T01:00:00Z"));
    assertThat(activeWork(issueId, humanId).orElseThrow().nextRunAt())
        .isEqualTo(Instant.parse("2026-10-20T01:00:00Z"));
    // 시각 없이 다시 SCHEDULED — 어제 시각이 남지 않는다.
    putReport(patToken, TOOL, Map.of("state", "SCHEDULED"));
    var w = activeWork(issueId, humanId).orElseThrow();
    assertThat(w.state()).isEqualTo("SCHEDULED");
    assertThat(w.nextRunAt()).isNull();
  }

  @Test
  void 다른_상태로_바꾸거나_행이_끝나면_시각을_비운다() {
    putReport(patToken, TOOL, Map.of("state", "SCHEDULED", "nextRunAt", NEXT_RUN));
    putReport(patToken, TOOL, Map.of("state", "WORKING"));
    var w = activeWork(issueId, humanId).orElseThrow();
    assertThat(w.state()).isEqualTo("WORKING");
    assertThat(w.nextRunAt()).isNull();

    putReport(patToken, TOOL, Map.of("state", "SCHEDULED", "nextRunAt", NEXT_RUN));
    putReport(patToken, TOOL, Map.of("state", "COMPLETED"));
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(
            dsl.select(AGENT_WORK.NEXT_RUN_AT)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                .and(AGENT_WORK.WORKER_ID.eq(humanId))
                .fetch(AGENT_WORK.NEXT_RUN_AT))
        .containsOnlyNulls();
  }

  @Test
  void 상태미지정_보고는_SCHEDULED_와_시각을_건드리지_않는다() {
    putReport(patToken, TOOL, Map.of("state", "SCHEDULED", "nextRunAt", NEXT_RUN));
    putReport(patToken, TOOL, Map.of("note", "메모만"));
    var w = activeWork(issueId, humanId).orElseThrow();
    assertThat(w.state()).isEqualTo("SCHEDULED");
    assertThat(w.nextRunAt()).isEqualTo(NEXT_RUN_INSTANT);
  }

  @Test
  void TODO_이슈에_SCHEDULED_보고는_이슈_상태를_바꾸지_않고_WORKING_은_진행중으로() {
    putReport(patToken, TOOL, Map.of("state", "SCHEDULED", "nextRunAt", NEXT_RUN));
    assertThat(issueStatus()).isEqualTo("TODO");
    putReport(patToken, TOOL, Map.of("state", "WORKING"));
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
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

  @Test
  void 질문은_메시지_목록_응답과_스레드_최근메시지에_question_true_로_나간다() {
    putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "A안과 B안 중 무엇으로 할까요?"));
    long threadId = chatThreadId();
    var page =
        json(
            call(
                HttpMethod.GET,
                "/api/v1/chat/threads/" + threadId + "/messages",
                jwtToken,
                null,
                null));
    var first = page.get("items").get(0);
    assertThat(first.get("question").asBoolean()).isTrue();
    assertThat(first.get("authorUsername").asText()).isNotBlank();
    var thread = json(call(HttpMethod.GET, issuePath() + "/chat/thread", jwtToken, null, null));
    assertThat(thread.get("recentMessages").get(0).get("question").asBoolean()).isTrue();
  }

  @Test
  void 사람의_일반_챗_글은_question_false() {
    postChat(jwtToken, "그냥 메모");
    long threadId = chatThreadId();
    var page =
        json(
            call(
                HttpMethod.GET,
                "/api/v1/chat/threads/" + threadId + "/messages",
                jwtToken,
                null,
                null));
    assertThat(page.get("items").get(0).get("question").asBoolean()).isFalse();
  }

  @Test
  void 삭제된_질문은_question_false() {
    putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "질문"));
    long threadId = chatThreadId();
    long msgId =
        json(call(
                HttpMethod.GET,
                "/api/v1/chat/threads/" + threadId + "/messages",
                jwtToken,
                null,
                null))
            .get("items")
            .get(0)
            .get("id")
            .asLong();
    // 작성자(AI) 본인만 지울 수 있다.
    assertOk(call(HttpMethod.DELETE, "/api/v1/chat/messages/" + msgId, akToken, null, null));
    var item =
        json(call(
                HttpMethod.GET,
                "/api/v1/chat/threads/" + threadId + "/messages",
                jwtToken,
                null,
                null))
            .get("items")
            .get(0);
    assertThat(item.get("deleted").asBoolean()).isTrue();
    assertThat(item.get("question").asBoolean()).isFalse();
  }

  @Test
  void 사람의_보고_message_는_AI구성원_INPUT_REQUIRED_를_풀지_않는다() {
    putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "질문"));
    // 사람이 자기 AI 도구로 진행을 남긴다 — 사람의 답이 아니다.
    assertOk(putReport(patToken, TOOL, Map.of("state", "WORKING", "message", "제 쪽 진행: 테스트 작성 중")));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("INPUT_REQUIRED");
    // 사람이 챗 입력창으로 답하면 푼다.
    assertOk(postChat(jwtToken, "A안으로"));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
  }
}
