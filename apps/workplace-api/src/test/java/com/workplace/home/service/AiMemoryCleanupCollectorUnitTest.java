package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.repository.AiMemoryCleanupRepository.Message;
import com.workplace.home.service.SessionCleanupInput.AssistantNote;
import com.workplace.home.service.SessionCleanupInput.Utterance;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * WP-385 스펙 5.2 입력 조립 — 사용자 발화 각 4,000자·합계 16,000자(앞쪽을 버림), AI 답 각 300자(바로 앞 발화 번호), memory 블록 id.
 */
class AiMemoryCleanupCollectorUnitTest {

  private static Message user(long id, String text) {
    return new Message(id, "USER", text, "COMPLETE", null, null);
  }

  private static Message ai(long id, String text) {
    return new Message(id, "ASSISTANT", text, "COMPLETE", null, null);
  }

  @Test
  void 발화는_각_4000자로_자르고_합계가_넘으면_오래된_것부터_버린다() {
    List<Message> msgs =
        List.of(
            user(1, "a".repeat(5_000)),
            user(2, "b".repeat(4_000)),
            user(3, "c".repeat(4_000)),
            user(4, "d".repeat(4_000)),
            user(5, "e".repeat(4_000)));

    List<Utterance> got = AiMemoryCleanupCollector.utterances(msgs);

    // 4,000 × 4 = 16,000 — 가장 오래된 1번(잘려도 4,000)은 넘쳐서 빠진다.
    assertThat(got).extracting(Utterance::messageId).containsExactly(2L, 3L, 4L, 5L);
    assertThat(got).allSatisfy(u -> assertThat(u.text()).hasSize(4_000));
  }

  @Test
  void 빈_발화는_빼고_앞뒤_공백을_걷는다() {
    List<Utterance> got =
        AiMemoryCleanupCollector.utterances(List.of(user(1, "   "), user(2, "  기억해줘  ")));
    assertThat(got).containsExactly(new Utterance(2, "기억해줘"));
  }

  @Test
  void AI_답은_300자로_자르고_바로_앞_발화_번호를_붙이며_첫_발화_앞의_답은_뺀다() {
    List<Message> msgs =
        List.of(
            ai(1, "경계 앞 답"),
            user(2, "첫 발화"),
            ai(3, "x".repeat(400)),
            user(4, "둘째 발화"),
            ai(5, ""),
            ai(6, "둘째 답"));
    List<Utterance> utts = AiMemoryCleanupCollector.utterances(msgs);

    List<AssistantNote> notes = AiMemoryCleanupCollector.notes(msgs, utts);

    assertThat(notes)
        .containsExactly(new AssistantNote(0, "x".repeat(300)), new AssistantNote(1, "둘째 답"));
  }

  @Test
  void 새_구간_답의_memory_블록에서_saved_updated_이고_되돌리지_않은_id_만_읽는다() {
    String blocks =
        "[{\"kind\":\"text\",\"textStart\":0},"
            + "{\"kind\":\"memory\",\"action\":\"saved\",\"memoryId\":11,\"undone\":false},"
            + "{\"kind\":\"memory\",\"action\":\"updated\",\"memoryId\":12,\"undone\":false},"
            + "{\"kind\":\"memory\",\"action\":\"saved\",\"memoryId\":13,\"undone\":true},"
            + "{\"kind\":\"memory\",\"action\":\"forgotten\",\"memoryId\":14,\"undone\":false}]";
    List<Message> msgs =
        List.of(new Message(7, "ASSISTANT", "답", "COMPLETE", blocks, null), ai(8, "블록 없음"));

    assertThat(
            AiMemoryCleanupCollector.blockMemoryIds(
                AiMemoryCleanupCollector.memoryBlocks(msgs, new ObjectMapper())))
        .containsExactly(11L, 12L);
  }

  @Test
  void 사용자_발화_글자_수는_공백을_걷고_코드포인트로_센다() {
    assertThat(AiMemoryCleanupCollector.userChars(List.of(user(1, "  😀가나 "), ai(2, "긴 답"))))
        .isEqualTo(3);
  }

  // 최종 리뷰 12: AI 답이 아주 많은 대화 — ai-agent zod 상한(500개)에 걸려 400 이 세 번 나면 그 대화 정리를 잃는다. 최근 것만 합계 상한
  // 안에서.
  @Test
  void AI_답은_최근_것부터_개수와_합계_상한_안에서만_싣는다() {
    List<Message> msgs = new java.util.ArrayList<>();
    msgs.add(user(1, "첫 발화"));
    for (int i = 0; i < 600; i++) msgs.add(ai(2 + i, "답" + i));
    for (int i = 0; i < 40; i++) msgs.add(ai(1_000 + i, "y".repeat(300)));
    List<Utterance> utts = AiMemoryCleanupCollector.utterances(msgs);

    List<AssistantNote> notes = AiMemoryCleanupCollector.notes(msgs, utts);

    assertThat(notes).hasSizeLessThanOrEqualTo(AiMemoryCleanupCollector.NOTES_COUNT_MAX);
    assertThat(notes.stream().mapToInt(n -> n.text().length()).sum())
        .isLessThanOrEqualTo(AiMemoryCleanupCollector.NOTES_TOTAL_MAX);
    // 가장 최근 답이 남고 오래된 것부터 버린다.
    assertThat(notes.get(notes.size() - 1).text()).isEqualTo("y".repeat(300));
    assertThat(notes).extracting(AssistantNote::text).doesNotContain("답0");
  }

  // 같은 이유로 사용자 발화도 개수 상한(zod 500) 안에서 최근 것만.
  @Test
  void 사용자_발화는_개수_상한을_넘으면_오래된_것부터_버린다() {
    List<Message> msgs = new java.util.ArrayList<>();
    for (int i = 0; i < 700; i++) msgs.add(user(1 + i, "발화" + i));

    List<Utterance> got = AiMemoryCleanupCollector.utterances(msgs);

    assertThat(got).hasSize(AiMemoryCleanupCollector.UTTERANCES_COUNT_MAX);
    assertThat(got.get(got.size() - 1).text()).isEqualTo("발화699");
  }

  // 최종 리뷰 2(b): 사용자가 이 구간 결과 줄에서 되돌린 memory 블록(동작 무관)의 id 를 보호 id 로 읽는다.
  @Test
  void 새_구간_답의_memory_블록에서_되돌린_id_를_보호_id_로_읽는다() {
    String blocks =
        "[{\"kind\":\"memory\",\"action\":\"saved\",\"memoryId\":11,\"undone\":false},"
            + "{\"kind\":\"memory\",\"action\":\"updated\",\"memoryId\":12,\"undone\":true},"
            + "{\"kind\":\"memory\",\"action\":\"forgotten\",\"memoryId\":13,\"undone\":true},"
            + "{\"kind\":\"memory\",\"action\":\"saved\",\"memoryId\":14,\"undone\":true}]";
    List<Message> msgs =
        List.of(
            new Message(7, "ASSISTANT", "답", "COMPLETE", "[{", null),
            new Message(8, "ASSISTANT", "답", "COMPLETE", blocks, null));

    assertThat(
            AiMemoryCleanupCollector.undoneMemoryIds(
                AiMemoryCleanupCollector.memoryBlocks(msgs, new ObjectMapper())))
        .containsExactly(12L, 13L, 14L);
  }

  // WP-386 최종 리뷰 M1: 공용 메모리 결과 줄(action "shared")의 memoryId 는 공용 표의 id 라 개인 id 와 겹칠 수 있다 — 개인 블록으로
  // 읽지 않는다.
  @Test
  void 공용_메모리_결과_줄은_보호_id_와_건드린_id_로_읽지_않는다() {
    String blocks =
        "[{\"kind\":\"memory\",\"action\":\"shared\",\"memoryId\":12,\"changeId\":5,\"undone\":true},"
            + "{\"kind\":\"memory\",\"action\":\"shared\",\"memoryId\":11,\"changeId\":6,\"undone\":false},"
            + "{\"kind\":\"memory\",\"action\":\"saved\",\"memoryId\":13,\"undone\":true},"
            + "{\"kind\":\"memory\",\"action\":\"saved\",\"memoryId\":14,\"undone\":false}]";
    var parsed =
        AiMemoryCleanupCollector.memoryBlocks(
            List.of(new Message(8, "ASSISTANT", "답", "COMPLETE", blocks, null)),
            new ObjectMapper());

    assertThat(AiMemoryCleanupCollector.undoneMemoryIds(parsed)).containsExactly(13L);
    assertThat(AiMemoryCleanupCollector.blockMemoryIds(parsed)).containsExactly(14L);
  }
}
