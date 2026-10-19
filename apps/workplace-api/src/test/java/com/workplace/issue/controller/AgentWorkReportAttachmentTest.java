package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.FILE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.AgentWorkTestSupport;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

/**
 * AI 작업 보고의 챗 첨부(WP-515) — report_agent_work 의 fileIds 가 message 챗 글의 첨부로 붙는지, 쓸 수 없는 파일이면 보고 전체가
 * 되돌려지는지 실제 HTTP 로 검증한다.
 */
class AgentWorkReportAttachmentTest extends AgentWorkTestSupport {

  @Test
  void 질문_보고의_fileIds_는_질문_글의_첨부로_붙고_영구파일이_된다() {
    long a = stageText(akToken, "a안.txt");
    long b = stageText(akToken, "b안.txt");

    var r =
        putReport(
            akToken,
            TOOL,
            Map.of(
                "state",
                "INPUT_REQUIRED",
                "message",
                "A안과 B안 중 무엇으로 할까요?",
                "fileIds",
                List.of(a, b)));

    assertOk(r);
    var m = lastChatMessage(issueId);
    assertThat(m.isQuestion()).isTrue();
    assertThat(attachedFileIds(m.id())).containsExactlyInAnyOrder(a, b);
    assertThat(expiresAt(a)).isNull();
    // 사람이 보는 메시지 목록 응답에도 첨부가 실린다.
    var list =
        json(
            call(
                HttpMethod.GET,
                "/api/v1/chat/threads/" + chatThreadId() + "/messages",
                jwtToken,
                null,
                null));
    assertThat(list.findValuesAsText("fileId"))
        .containsExactlyInAnyOrder(String.valueOf(a), String.valueOf(b));
  }

  @Test
  void 종료_보고의_fileIds_도_message_글에_붙는다() {
    long f = stageText(akToken, "결과.txt");

    assertOk(
        putReport(
            akToken, TOOL, Map.of("state", "COMPLETED", "message", "마쳤어요", "fileIds", List.of(f))));

    assertThat(attachedFileIds(lastChatMessage(issueId).id())).containsExactly(f);
  }

  @Test
  void 남의_스테이징_파일이면_400_이고_작업상태와_챗은_그대로() {
    long humans = stageText(jwtToken, "사람.txt");
    seedActive(issueId, agentId, "WORKING");

    var r =
        putReport(
            akToken,
            TOOL,
            Map.of("state", "INPUT_REQUIRED", "message", "질문", "fileIds", List.of(humans)));

    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
    assertThat(lastChatMessageOrNull(issueId)).isNull();
  }

  @Test
  void 만료된_파일이면_400() {
    long f = stageText(akToken, "만료.txt");
    inTenant(
        () ->
            dsl.update(FILE)
                .set(FILE.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
                .where(FILE.ID.eq(f))
                .execute());

    var r = putReport(akToken, TOOL, Map.of("message", "보고", "fileIds", List.of(f)));

    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(lastChatMessageOrNull(issueId)).isNull();
  }

  @Test
  void 이미_붙은_파일을_다시_보내면_400_이고_두번째_글은_남지_않는다() {
    long f = stageText(akToken, "한번.txt");
    assertOk(putReport(akToken, TOOL, Map.of("message", "첫 보고", "fileIds", List.of(f))));

    var r = putReport(akToken, TOOL, Map.of("message", "두 번째 보고", "fileIds", List.of(f)));

    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(lastChatMessage(issueId).body()).isEqualTo("첫 보고");
  }

  @Test
  void message_없이_fileIds_만_보내면_400() {
    long f = stageText(akToken, "글없음.txt");

    var r = putReport(akToken, TOOL, Map.of("state", "WORKING", "fileIds", List.of(f)));

    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(activeWork(issueId, agentId)).isEmpty();
  }

  @Test
  void fileIds_11개는_400() {
    var ids = java.util.stream.LongStream.rangeClosed(1, 11).boxed().toList();

    var r = putReport(akToken, TOOL, Map.of("message", "많음", "fileIds", ids));

    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
  }

  /** 챗 글에 붙은 파일 id. */
  private List<Long> attachedFileIds(long messageId) {
    return inTenant(
        () ->
            dsl.select(CHAT_MESSAGE_ATTACHMENT.FILE_ID)
                .from(CHAT_MESSAGE_ATTACHMENT)
                .where(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
                .fetch(CHAT_MESSAGE_ATTACHMENT.FILE_ID));
  }

  /** 파일 만료 시각 — 영구로 클레임되면 null. */
  private OffsetDateTime expiresAt(long fileId) {
    return inTenant(
        () ->
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(fileId))
                .fetchOne(FILE.EXPIRES_AT));
  }
}
