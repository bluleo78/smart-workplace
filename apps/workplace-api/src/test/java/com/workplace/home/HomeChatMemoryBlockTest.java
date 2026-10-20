package com.workplace.home;

import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.home.dto.HomeChatStartedResponse;
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

  /** 결과 줄 블록 JSON 에 자리(at — 앞에 오는 표시 블록 수, WP-581)를 붙인다. */
  private static String at(String block, int at) {
    return block.substring(0, block.length() - 1) + ",\"at\":" + at + "}";
  }

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
    return assistantAfter(uid, script, false);
  }

  /**
   * 시나리오를 돌린 뒤 정상 완료(onDone, 시나리오가 돌려준 본문) 또는 오류(onError — 본문은 버린다)로 끝내고 영속된 ASSISTANT 메시지를 돌려준다.
   * 종결 콜백이 동기로 영속을 마친 뒤 latch 가 풀린다.
   */
  private HomeMessageResponse assistantAfter(long uid, Script script, boolean fail)
      throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<String> onDelta = inv.getArgument(1);
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              Consumer<String> onError = inv.getArgument(3);
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
              String fullText = script.run(onDelta, onProgress, tool);
              if (fail) onError.accept("AI 구성 요청에 실패했어요.");
              else onDone.accept(fullText, null);
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
    // 답보다 먼저 기억했으니 앞에 오는 표시 블록이 없다(at 0 — 웹이 답 아래에 둔다).
    assertThat(a.memoryBlocks()).isEqualTo(om.readTree("[" + at(SAVED_BLOCK, 0) + "]"));
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
                    + "\"content\":\"표 대신 목록\",\"previousContent\":\"짧은 목록\",\"source\":\"AI\",\"undone\":false,"
                    + "\"at\":1}"));
  }

  /**
   * Review Focus 5: 위임 답은 라우터 안내 text 블록이 버려지지만 memory 블록은 도착순 그대로 끝에 남는다(순번 = 라이브 순번). WP-581: 결과
   * 줄 뒤의 도구는 새 그룹이라, 안내 text 가 버려져도 결과 줄 사이 두 그룹을 합치지 않는다 — 결과 줄은 그 사이(at 1)에 온다.
   */
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
                "[{\"kind\":\"tools\",\"stepStart\":0},{\"kind\":\"tools\",\"stepStart\":1},"
                    + "{\"kind\":\"text\",\"textStart\":0}]"));
    assertThat(a.memoryBlocks())
        .isEqualTo(om.readTree("[" + at(SAVED_BLOCK, 1) + "," + at(FORGOTTEN_BLOCK, 3) + "]"));
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
    assertThat(json.path("memoryBlocks")).isEqualTo(om.readTree("[" + at(SAVED_BLOCK, 1) + "]"));
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

  /**
   * 텍스트 전에 오류로 끝나도 메모리 결과 줄이 있으면 답을 저장한다 — 메모리 변경은 이미 반영됐으므로 error 의 messageId 로 되돌리기가 켜지고 다시 열어도
   * 줄이 남는다(빈 본문 + memory 블록).
   */
  @Test
  void 텍스트_없이_오류로_끝나도_메모리_결과가_있으면_답을_저장하고_error_에_messageId_를_싣는다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(start(1, "remember_memory"));
              tool.accept(result(1, "remember_memory", false, SAVED));
              return "";
            },
            true);

    assertThat(a.role()).isEqualTo("ASSISTANT");
    assertThat(a.content()).isEmpty();
    assertThat(a.status()).isEqualTo("FAILED");
    assertThat(a.contentBlocks()).isNull();
    assertThat(a.memoryBlocks()).isEqualTo(om.readTree("[" + SAVED_BLOCK + "]"));
    assertThat(emitted("home.chat.error"))
        .singleElement()
        .satisfies(p -> assertThat(p.get("messageId")).isEqualTo(a.id()));
  }

  /**
   * 공백뿐인 본문("\n")으로 오류 종료해도 메모리 결과 줄이 있으면 답을 저장하되 본문은 ""로 정규화한다 — 웹의 content === '' 판정과 AI 맥락 필터(빈
   * 본문 중단·오류 답 제외)가 모두 "빈 답" 으로 보게. 블록도 정규화한 본문 기준이라 공백 text 블록이 남지 않는다(남으면 웹 복원이 빈 답으로 보지 않아 자리 문구
   * 없이 "중단됨" 만 그린다).
   */
  @Test
  void 공백뿐인_본문으로_오류_종료하면_본문을_빈_문자열로_저장하고_맥락에서_뺀다() throws Exception {
    long uid = user();
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              delta.accept("\n");
              tool.accept(start(1, "remember_memory"));
              tool.accept(result(1, "remember_memory", false, SAVED));
              return "";
            },
            true);

    assertThat(a.status()).isEqualTo("FAILED");
    assertThat(a.content()).isEmpty();
    assertThat(a.contentBlocks()).isNull();
    assertThat(a.memoryBlocks()).isEqualTo(om.readTree("[" + SAVED_BLOCK + "]"));
    // 영속 JSON 자체에도 text 블록 없이 memory 블록만 있다.
    assertThat(om.readTree(storedBlocks(a.id()))).isEqualTo(om.readTree("[" + SAVED_BLOCK + "]"));
    UUID sid = onlySession(uid);
    assertThat(sessionService.getContextSource(uid, sid).rows())
        .extracting(r -> r.role())
        .containsExactly("USER");
  }

  /** R1: 정지로 끝난 공백뿐인 답도 같은 규칙 — 본문 "" + memory 블록만 저장하고 맥락에서 뺀다. */
  @Test
  void 공백뿐인_본문으로_정지하면_본문을_빈_문자열로_저장하고_text_블록을_남기지_않는다() throws Exception {
    long uid = user();
    CountDownLatch started = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<String> onDelta = inv.getArgument(1);
              Consumer<JsonNode> onTool = inv.getArgument(6);
              onDelta.accept("\n");
              onTool.accept(om.readTree(start(1, "remember_memory")));
              onTool.accept(om.readTree(result(1, "remember_memory", false, SAVED)));
              started.countDown();
              try {
                new CountDownLatch(1).await(5, TimeUnit.SECONDS); // 취소 인터럽트까지 붙잡는다
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt(); // 실제 클라이언트처럼 플래그만 세우고 조용히 return
              }
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());
    HomeChatStartedResponse r = chatService.startChat(uid, null, "질문");
    assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
    chatService.cancelChat(r.correlationId(), uid);
    verify(sseRegistry, timeout(5000)).fanOut(any(), eq("home.chat.cancelled"), any());
    UUID sid = r.sessionId();
    HomeMessageResponse a = sessionService.getMessages(uid, sid).get(1);

    assertThat(a.status()).isEqualTo("STOPPED");
    assertThat(a.content()).isEmpty();
    assertThat(a.contentBlocks()).isNull();
    assertThat(a.memoryBlocks()).isEqualTo(om.readTree("[" + SAVED_BLOCK + "]"));
    assertThat(om.readTree(storedBlocks(a.id()))).isEqualTo(om.readTree("[" + SAVED_BLOCK + "]"));
    assertThat(sessionService.getContextSource(uid, sid).rows())
        .extracting(row -> row.role())
        .containsExactly("USER");
  }

  /** 영속된 content_blocks 원문 JSON. */
  private String storedBlocks(long messageId) {
    return dsl.select(HOME_MESSAGE.CONTENT_BLOCKS)
        .from(HOME_MESSAGE)
        .where(HOME_MESSAGE.ID.eq(messageId))
        .fetchOne(r -> r.value1().data());
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

  /** CR1: 고침 결과의 이전 종류는 블록에 남고(되돌리기가 종류도 돌려놓는다) 재발행에도 실린다. 모르는 종류는 버리되 줄은 만든다. */
  @Test
  void 고침_결과의_이전_종류를_블록에_남기고_모르는_종류는_버린다() throws Exception {
    long uid = user();
    String known =
        "{\"action\":\"updated\",\"memoryId\":12,\"kind\":\"CONTEXT\",\"content\":\"백엔드 팀이다\","
            + "\"previousContent\":\"짧은 목록\",\"previousKind\":\"PREFERENCE\",\"source\":\"AI\"}";
    String unknown =
        "{\"action\":\"updated\",\"memoryId\":13,\"kind\":\"CONTEXT\",\"content\":\"프론트 팀이다\","
            + "\"previousContent\":\"짧은 목록\",\"previousKind\":\"GOAL\",\"source\":\"AI\"}";
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(start(1, "update_memory"));
              tool.accept(result(1, "update_memory", false, known));
              tool.accept(start(2, "update_memory"));
              tool.accept(result(2, "update_memory", false, unknown));
              delta.accept("고쳤어요.");
              return "고쳤어요.";
            });

    assertThat(a.memoryBlocks())
        .isEqualTo(
            om.readTree(
                "[{\"kind\":\"memory\",\"action\":\"updated\",\"memoryId\":12,\"memoryKind\":\"CONTEXT\","
                    + "\"content\":\"백엔드 팀이다\",\"previousContent\":\"짧은 목록\",\"previousKind\":\"PREFERENCE\","
                    + "\"source\":\"AI\",\"undone\":false,\"at\":0},"
                    + "{\"kind\":\"memory\",\"action\":\"updated\",\"memoryId\":13,\"memoryKind\":\"CONTEXT\","
                    + "\"content\":\"프론트 팀이다\",\"previousContent\":\"짧은 목록\",\"source\":\"AI\",\"undone\":false,"
                    + "\"at\":0}]"));
    Map<?, ?> knownMap = om.readValue(known, Map.class);
    assertThat(emitted("home.chat.tool"))
        .anySatisfy(p -> assertThat(p.get("memory")).isEqualTo(knownMap));
  }

  /**
   * WP-379: 결과의 scope·previousScope 를 블록에 남긴다(null = 공통이라 빠진다). 모르는 범위면 되돌리기가 엉뚱한 범위로 복원하므로 줄을 만들지
   * 않는다.
   */
  @Test
  void 범위는_블록에_남기고_모르는_범위의_결과는_줄을_만들지_않는다() throws Exception {
    long uid = user();
    String updated =
        "{\"action\":\"updated\",\"memoryId\":12,\"kind\":\"PREFERENCE\",\"content\":\"이슈는 짧게\","
            + "\"previousContent\":\"짧게\",\"source\":\"AI\",\"scope\":\"ISSUE\",\"previousScope\":null}";
    String bad =
        "{\"action\":\"saved\",\"memoryId\":13,\"kind\":\"PREFERENCE\",\"content\":\"x\",\"source\":\"AI\",\"scope\":\"CONTACTS\"}";
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(result(1, "update_memory", false, updated));
              tool.accept(result(2, "remember_memory", false, bad));
              delta.accept("고쳤어요.");
              return "고쳤어요.";
            });

    assertThat(a.memoryBlocks()).hasSize(1);
    assertThat(a.memoryBlocks().get(0))
        .isEqualTo(
            om.readTree(
                "{\"kind\":\"memory\",\"action\":\"updated\",\"memoryId\":12,\"memoryKind\":\"PREFERENCE\","
                    + "\"content\":\"이슈는 짧게\",\"previousContent\":\"짧게\",\"source\":\"AI\",\"undone\":false,"
                    + "\"scope\":\"ISSUE\",\"at\":0}"));
  }

  /** WP-380: 결과의 기한·이전 기한을 블록에 남기고(없으면 빠짐), yyyy-MM-dd 가 아닌 기한이면 줄을 만들지 않는다. */
  @Test
  void 기한은_블록에_남기고_형식이_틀린_기한의_결과는_줄을_만들지_않는다() throws Exception {
    long uid = user();
    String updated =
        "{\"action\":\"updated\",\"memoryId\":12,\"kind\":\"PREFERENCE\",\"content\":\"결제 모듈\","
            + "\"previousContent\":\"결제 모듈\",\"source\":\"AI\",\"expiresOn\":\"2026-10-19\",\"previousExpiresOn\":null}";
    String bad =
        "{\"action\":\"saved\",\"memoryId\":13,\"kind\":\"PREFERENCE\",\"content\":\"x\",\"source\":\"AI\",\"expiresOn\":\"10/19\"}";
    HomeMessageResponse a =
        assistantAfter(
            uid,
            (delta, progress, tool) -> {
              tool.accept(result(1, "update_memory", false, updated));
              tool.accept(result(2, "remember_memory", false, bad));
              delta.accept("기한을 정했어요.");
              return "기한을 정했어요.";
            });

    assertThat(a.memoryBlocks()).hasSize(1);
    assertThat(a.memoryBlocks().get(0).path("expiresOn").asText()).isEqualTo("2026-10-19");
    assertThat(a.memoryBlocks().get(0).has("previousExpiresOn")).isFalse();
  }
}
