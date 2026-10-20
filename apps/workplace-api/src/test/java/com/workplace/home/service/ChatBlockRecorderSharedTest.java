package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-386: 공용 저장 결과 줄 — 모양 검사, 개인 결과 줄과 같은 목록·순번, 직렬화 모양, 도구 이름 판별. */
class ChatBlockRecorderSharedTest {

  private static final ObjectMapper OM = new ObjectMapper();

  private static ObjectNode shared() {
    ObjectNode m = OM.createObjectNode();
    m.put("action", "shared")
        .put("changeId", 7)
        .put("memoryId", 3)
        .put("spaceName", "Smart Workplace(WP)");
    m.put("content", "PR 설명에는 캡처를 붙인다");
    return m;
  }

  @Test
  void 공용_저장_블록을_만든다() {
    var b = ChatBlockRecorder.memoryBlockOf(shared());
    assertThat(b).isInstanceOf(ChatBlockRecorder.SharedMemory.class);
    var s = (ChatBlockRecorder.SharedMemory) b;
    assertThat(s.kind()).isEqualTo("memory");
    assertThat(s.changeId()).isEqualTo(7);
    assertThat(s.memoryId()).isEqualTo(3);
    assertThat(s.undone()).isFalse();
  }

  @Test
  void 모양이_틀리면_만들지_않는다() {
    assertThat(ChatBlockRecorder.memoryBlockOf(shared().put("changeId", 0))).isNull();
    assertThat(ChatBlockRecorder.memoryBlockOf(shared().put("memoryId", -1))).isNull();
    assertThat(ChatBlockRecorder.memoryBlockOf(shared().put("changeId", "7"))).isNull();
    assertThat(ChatBlockRecorder.memoryBlockOf(shared().put("content", " "))).isNull();
    assertThat(ChatBlockRecorder.memoryBlockOf(shared().put("spaceName", ""))).isNull();
    assertThat(ChatBlockRecorder.memoryBlockOf(null)).isNull();
    assertThat(ChatBlockRecorder.memoryBlockOf(OM.createArrayNode())).isNull();
  }

  @Test
  void 개인_결과_줄과_같은_목록에_도착순으로_붙고_JSON_은_memory_종류다() throws Exception {
    var rec = new ChatBlockRecorder();
    rec.onDelta("네");
    ObjectNode personal = OM.createObjectNode();
    personal
        .put("action", "saved")
        .put("memoryId", 1)
        .put("kind", "PREFERENCE")
        .put("content", "짧게");
    rec.onMemory(ChatBlockRecorder.memoryBlockOf(personal));
    rec.onMemory(ChatBlockRecorder.memoryBlockOf(shared()));
    List<ChatBlockRecorder.Block> out = rec.finish("네");
    String json = OM.writeValueAsString(out);
    assertThat(json)
        .contains(
            "{\"kind\":\"memory\",\"action\":\"shared\",\"changeId\":7,\"memoryId\":3,"
                + "\"spaceName\":\"Smart Workplace(WP)\",\"content\":\"PR 설명에는 캡처를 붙인다\",\"undone\":false,"
                + "\"at\":1}");
    assertThat(out.get(out.size() - 2)).isInstanceOf(ChatBlockRecorder.Memory.class);
    assertThat(out.get(out.size() - 1)).isInstanceOf(ChatBlockRecorder.SharedMemory.class);
  }

  @Test
  void 공용_요청_도구도_메모리_도구다() {
    assertThat(HomeChatService.isMemoryTool("mcp__workplace__remember_shared_memory")).isTrue();
    assertThat(HomeChatService.isMemoryTool("workplace_remember_shared_memory")).isTrue();
  }
}
