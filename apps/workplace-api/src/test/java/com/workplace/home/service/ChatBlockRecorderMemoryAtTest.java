package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * WP-581: 메모리 결과 줄의 자리(at) — 결과 줄 뒤의 도구·텍스트는 새 블록으로 시작하고, 결과 줄마다 앞에 오는 표시 블록 수를 남긴다. 위임 안내 문장을 버려도
 * 결과 줄 사이 도구 그룹은 합치지 않는다.
 */
class ChatBlockRecorderMemoryAtTest {

  private static final ObjectMapper OM = new ObjectMapper();

  private static ChatBlockRecorder.Block memory(long id) {
    ObjectNode m = OM.createObjectNode();
    m.put("action", "saved").put("memoryId", id).put("kind", "PREFERENCE").put("content", "짧게");
    return ChatBlockRecorder.memoryBlockOf(m);
  }

  private static String json(List<ChatBlockRecorder.Block> blocks) throws Exception {
    return OM.writeValueAsString(blocks);
  }

  @Test
  void 결과_줄_뒤의_도구는_새_그룹으로_시작하고_자리는_그룹_사이다() {
    var rec = new ChatBlockRecorder();
    rec.onStep(0); // 위임
    rec.onStep(1);
    rec.onMemory(memory(1));
    rec.onMemory(memory(2));
    rec.onStep(2);
    rec.onDelta("정리했어요.");

    List<ChatBlockRecorder.Block> out = rec.finish("정리했어요.");

    assertThat(out.subList(0, 3))
        .containsExactly(
            new ChatBlockRecorder.Tools(0),
            new ChatBlockRecorder.Tools(2),
            new ChatBlockRecorder.Text(0));
    assertThat(((ChatBlockRecorder.Memory) out.get(3)).at()).isEqualTo(1);
    assertThat(((ChatBlockRecorder.Memory) out.get(4)).at()).isEqualTo(1);
  }

  @Test
  void 결과_줄_뒤의_텍스트도_새_블록으로_시작한다() {
    var rec = new ChatBlockRecorder();
    rec.onDelta("확인했어요. ");
    rec.onMemory(memory(1));
    rec.onDelta("기억해 둘게요.");

    List<ChatBlockRecorder.Block> out = rec.finish("확인했어요. 기억해 둘게요.");

    assertThat(out.subList(0, 2))
        .containsExactly(new ChatBlockRecorder.Text(0), new ChatBlockRecorder.Text(7));
    assertThat(((ChatBlockRecorder.Memory) out.get(2)).at()).isEqualTo(1);
  }

  @Test
  void 답보다_먼저_기억하면_자리는_0_이고_끝에_온_줄은_마지막_블록_뒤다() {
    var rec = new ChatBlockRecorder();
    rec.onMemory(memory(1));
    rec.onDelta("알겠어요.");
    rec.onMemory(memory(2));

    List<ChatBlockRecorder.Block> out = rec.finish("알겠어요.");

    assertThat(out.get(0)).isEqualTo(new ChatBlockRecorder.Text(0));
    assertThat(((ChatBlockRecorder.Memory) out.get(1)).at()).isZero();
    assertThat(((ChatBlockRecorder.Memory) out.get(2)).at()).isEqualTo(1);
  }

  @Test
  void 위임_안내_문장을_버려도_결과_줄_사이_그룹은_합치지_않고_결과_줄이_없으면_합친다() {
    // 결과 줄 없음 — 안내 문장(버림) 사이의 두 그룹은 기존대로 하나로 합친다.
    var plain = new ChatBlockRecorder();
    plain.onStep(0);
    plain.onDelta("확인해 볼게요. ");
    plain.onStep(1);
    plain.onDelta("바꿨어요.");
    assertThat(plain.finish("바꿨어요."))
        .containsExactly(new ChatBlockRecorder.Tools(0), new ChatBlockRecorder.Text(0));

    // 안내 문장 뒤에 결과 줄 — 문장이 버려져도 결과 줄이 두 그룹 사이에 남는다.
    var rec = new ChatBlockRecorder();
    rec.onStep(0);
    rec.onDelta("확인해 볼게요. ");
    rec.onMemory(memory(1));
    rec.onStep(1);
    rec.onDelta("바꿨어요.");
    List<ChatBlockRecorder.Block> out = rec.finish("바꿨어요.");
    assertThat(out.subList(0, 3))
        .containsExactly(
            new ChatBlockRecorder.Tools(0),
            new ChatBlockRecorder.Tools(1),
            new ChatBlockRecorder.Text(0));
    assertThat(((ChatBlockRecorder.Memory) out.get(3)).at()).isEqualTo(1);
  }

  @Test
  void 표시_블록을_못_믿어_버리면_결과_줄에_자리를_남기지_않는다() throws Exception {
    var rec = new ChatBlockRecorder();
    rec.onDelta("스트리밍 텍스트");
    rec.onMemory(memory(1));

    List<ChatBlockRecorder.Block> out = rec.finish("전혀 다른 본문");

    assertThat(out).hasSize(1);
    assertThat(((ChatBlockRecorder.Memory) out.get(0)).at()).isNull();
    assertThat(json(out)).doesNotContain("\"at\"");
  }
}
