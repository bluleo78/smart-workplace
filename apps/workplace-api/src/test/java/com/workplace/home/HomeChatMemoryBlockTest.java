package com.workplace.home;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.home.dto.HomeMessageResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * WP-55: 메모리 도구 결과 → 결과 줄 블록 영속·재발행, done messageId. 펌프가 다른 스레드에서 커밋하므로 @Transactional 없이
 * HomeAttachmentTestSupport 의 정리(home_session → user)를 쓴다.
 */
class HomeChatMemoryBlockTest extends HomeAttachmentTestSupport {

  private static final String SAVED =
      "{\"action\":\"saved\",\"memoryId\":12,\"kind\":\"PREFERENCE\",\"content\":\"짧은 목록으로 보여 준다\",\"source\":\"AI\"}";
  private static final String FORGOTTEN =
      "{\"action\":\"forgotten\",\"memoryId\":9,\"kind\":\"CONTEXT\",\"content\":\"백엔드 팀이다\",\"source\":\"USER\"}";
  private static final String SAVED_BLOCK =
      "{\"kind\":\"memory\",\"action\":\"saved\",\"memoryId\":12,\"memoryKind\":\"PREFERENCE\","
          + "\"content\":\"짧은 목록으로 보여 준다\",\"source\":\"AI\",\"undone\":false}";
  private static final String FORGOTTEN_BLOCK =
      "{\"kind\":\"memory\",\"action\":\"forgotten\",\"memoryId\":9,\"memoryKind\":\"CONTEXT\","
          + "\"content\":\"백엔드 팀이다\",\"source\":\"USER\",\"undone\":false}";

  /** 스트림 시나리오 — tool 은 tool 이벤트 JSON 을 그대로 흘린다. 최종 fullText 를 돌려준다. */
  @FunctionalInterface
  private interface Script {
    String run(Consumer<String> delta, Consumer<String> progress, Consumer<String> tool)
        throws Exception;
  }

  private static String start(int seq, String tool) {
    return "{\"phase\":\"start\",\"seq\":" + seq + ",\"toolName\":\"" + tool + "\",\"args\":{}}";
  }

  private static String result(int seq, String tool, boolean isError, String memoryJson) {
    return "{\"phase\":\"result\",\"seq\":"
        + seq
        + ",\"toolName\":\""
        + tool
        + "\",\"isError\":"
        + isError
        + (memoryJson == null ? "" : ",\"memory\":" + memoryJson)
        + "}";
  }

  /** 시나리오를 돌려 영속된 ASSISTANT 메시지를 돌려준다(onDone 이 동기로 영속을 마친 뒤 latch 가 풀린다). */
  private HomeMessageResponse assistantAfter(long uid, Script script) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<String> onDelta = inv.getArgument(1);
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              Consumer<String> onProgress = inv.getArgument(4);
              Consumer<JsonNode> onTool = inv.getArgument(6);
              Consumer<String> tool =
                  json -> {
                    try {
                      onTool.accept(om.readTree(json));
                    } catch (Exception e) {
                      throw new IllegalStateException(e);
                    }
                  };
              onDone.accept(script.run(onDelta, onProgress, tool), null);
              done.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());
    chatService.startChat(uid, null, "질문");
    assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
    UUID sid = onlySession(uid);
    return sessionService.getMessages(uid, sid).get(1);
  }

  /** 재발행된 이벤트 payload 들(이름별). */
  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> emitted(String event) {
    ArgumentCaptor<Object> c = ArgumentCaptor.forClass(Object.class);
    verify(sseRegistry, atLeastOnce()).fanOut(any(), eq(event), c.capture());
    return c.getAllValues().stream().map(p -> (Map<String, Object>) p).toList();
  }

  @Test
  void 메모리_도구_성공_결과는_memory_블록으로_끝에_영속되고_도구_단계에는_없다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(start(1, "remember_memory"));
              tool.accept(result(1, "remember_memory", false, SAVED));
              delta.accept("기억할게요.");
              return "기억할게요.";
            });

    // 이력 응답은 memory 블록을 contentBlocks 에서 떼어 memoryBlocks 로 따로 싣는다(구 웹 보호 — 영속은 끝에 붙인 그대로).
    assertThat(a.contentBlocks()).isEqualTo(om.readTree("[{\"kind\":\"text\",\"textStart\":0}]"));
    assertThat(a.memoryBlocks()).isEqualTo(om.readTree("[" + SAVED_BLOCK + "]"));
    assertThat(a.toolCalls()).isNull(); // 메모리 도구는 도구 단계 목록에 없다(결과 줄과 중복)
    Map<?, ?> saved = om.readValue(SAVED, Map.class);
    assertThat(emitted("home.chat.tool"))
        .anySatisfy(p -> assertThat(p.get("memory")).isEqualTo(saved));
  }

  @Test
  void opencode_접두와_이전_내용도_기록하고_source_가_없으면_AI() throws Exception {
    long uid = user();
    String updated =
        "{\"action\":\"updated\",\"memoryId\":12,\"kind\":\"PREFERENCE\",\"content\":\"표 대신 목록\",\"previousContent\":\"짧은 목록\"}";
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              delta.accept("고쳤어요.");
              tool.accept(start(1, "workplace_update_memory"));
              tool.accept(result(1, "workplace_update_memory", false, updated));
              return "고쳤어요.";
            });

    assertThat(a.toolCalls()).isNull(); // 접두가 붙은 메모리 도구도 도구 단계에 없다
    assertThat(a.memoryBlocks().get(0))
        .isEqualTo(
            om.readTree(
                "{\"kind\":\"memory\",\"action\":\"updated\",\"memoryId\":12,\"memoryKind\":\"PREFERENCE\","
                    + "\"content\":\"표 대신 목록\",\"previousContent\":\"짧은 목록\",\"source\":\"AI\",\"undone\":false}"));
  }

  /** Review Focus 5: 위임 답은 라우터 안내 text 블록이 버려지지만 memory 블록은 도착순 그대로 끝에 남는다(순번 = 라이브 순번). */
  @Test
  void 위임_답이어도_memory_블록은_순번_그대로_남는다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              progress.accept("이슈 전문가에게 위임 중");
              delta.accept("확인해 볼게요. ");
              tool.accept(start(1, "mcp__workplace__remember_memory"));
              tool.accept(result(1, "mcp__workplace__remember_memory", false, SAVED));
              tool.accept(start(2, "update_issue"));
              delta.accept("상태를 바꿨어요.");
              tool.accept(start(3, "forget_memory"));
              tool.accept(result(3, "forget_memory", false, FORGOTTEN));
              return "상태를 바꿨어요.";
            });

    assertThat(a.content()).isEqualTo("상태를 바꿨어요.");
    assertThat(a.contentBlocks())
        .isEqualTo(
            om.readTree(
                "[{\"kind\":\"tools\",\"stepStart\":0},{\"kind\":\"text\",\"textStart\":0}]"));
    assertThat(a.memoryBlocks())
        .isEqualTo(om.readTree("[" + SAVED_BLOCK + "," + FORGOTTEN_BLOCK + "]"));
  }

  /** 판정 5: 오프셋을 못 믿어 표시 블록을 버리는 턴에도 memory 블록은 남는다 — 되돌리기가 동작해야 한다. */
  @Test
  void 본문이_스트리밍과_어긋나도_memory_블록만은_남는다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(start(1, "remember_memory"));
              tool.accept(result(1, "remember_memory", false, SAVED));
              delta.accept("스트리밍 텍스트");
              return "전혀 다른 본문";
            });

    // 표시 블록이 없으면 contentBlocks 는 null(구 웹 폴백 렌더 — 빈 배열이면 본문을 그리지 않는다).
    assertThat(a.contentBlocks()).isNull();
    assertThat(a.memoryBlocks()).isEqualTo(om.readTree("[" + SAVED_BLOCK + "]"));
  }

  @Test
  void 오류_모양이_틀린_결과_메모리_도구가_아닌_결과는_블록을_만들지_않고_재발행에서도_뺀다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(result(1, "remember_memory", true, SAVED));
              tool.accept(
                  result(
                      2,
                      "remember_memory",
                      false,
                      "{\"action\":\"saved\",\"memoryId\":12,\"kind\":\"PREFERENCE\",\"content\":\"\"}"));
              tool.accept(
                  result(
                      3,
                      "update_memory",
                      false,
                      "{\"action\":\"updated\",\"memoryId\":12,\"kind\":\"PREFERENCE\",\"content\":\"x\"}"));
              tool.accept(result(4, "list_issues", false, SAVED));
              delta.accept("완료");
              return "완료";
            });

    assertThat(a.contentBlocks()).isEqualTo(om.readTree("[{\"kind\":\"text\",\"textStart\":0}]"));
    assertThat(a.memoryBlocks()).isNull();
    assertThat(emitted("home.chat.tool"))
        .hasSize(4)
        .allSatisfy(p -> assertThat(p).doesNotContainKey("memory"));
  }

  /** F-b: updated 의 이전 내용이 공백뿐이면 되돌릴 수 없으므로 결과 줄을 만들지 않고 재발행에서도 뺀다. */
  @Test
  void 고침_결과의_이전_내용이_공백이면_블록을_만들지_않는다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(
                  result(
                      1,
                      "update_memory",
                      false,
                      "{\"action\":\"updated\",\"memoryId\":12,\"kind\":\"PREFERENCE\",\"content\":\"x\",\"previousContent\":\"  \"}"));
              delta.accept("고쳤어요.");
              return "고쳤어요.";
            });

    assertThat(a.memoryBlocks()).isNull();
    assertThat(emitted("home.chat.tool"))
        .singleElement()
        .satisfies(p -> assertThat(p).doesNotContainKey("memory"));
  }

  /** 이력 응답 JSON — contentBlocks 에 memory 종류가 없고 memoryBlocks 필드 이름으로 따로 실린다(새 웹이 이 이름을 읽는다). */
  @Test
  void 이력_응답_JSON_은_memoryBlocks_로_따로_싣는다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              delta.accept("기억할게요.");
              tool.accept(result(1, "remember_memory", false, SAVED));
              return "기억할게요.";
            });

    JsonNode json = om.valueToTree(a);
    assertThat(json.path("contentBlocks").findValuesAsText("kind")).doesNotContain("memory");
    assertThat(json.path("memoryBlocks")).isEqualTo(om.readTree("[" + SAVED_BLOCK + "]"));
  }

  /** F-g: opencode 접두(workplace_)도 벗긴다 — show_* 는 위젯 블록, propose_* 는 숨김이라 도구 단계가 없다. */
  @Test
  void opencode_접두의_show_는_위젯_블록이고_propose_와_함께_도구_단계에_없다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(start(1, "workplace_show_issue_list"));
              tool.accept(start(2, "workplace_propose_create_issue"));
              delta.accept("보여 드릴게요.");
              return "보여 드릴게요.";
            });

    assertThat(a.toolCalls()).isNull();
    assertThat(a.contentBlocks())
        .isEqualTo(
            om.readTree(
                "[{\"kind\":\"widget\",\"widget\":{\"type\":\"issue_list\",\"params\":{}}},"
                    + "{\"kind\":\"text\",\"textStart\":0}]"));
  }

  @Test
  void done_이벤트에_저장한_messageId_가_실린다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              delta.accept("네");
              return "네";
            });

    assertThat(emitted("home.chat.done"))
        .singleElement()
        .satisfies(p -> assertThat(p.get("messageId")).isEqualTo(a.id()));
  }
}
