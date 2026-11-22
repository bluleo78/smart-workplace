package com.workplace.agentruntime.screen;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 세션 하나의 입력 기록 버퍼(WP-1277) — runner 로 넘긴 키 입력 바이트를 모았다가 약 1초마다 한 덩어리 글자로 꺼낸다. 저장 형식은 UTF-8 글자 그대로,
 * 제어 문자는 {@code \x1b} 같은 표기, 역슬래시는 {@code \\}.
 *
 * <p>세션당 {@link #CAP_BYTES} 까지만 기록한다. 넘으면 그 앞까지만 남기고 표시 행 {@link #CAP_MARKER} 를 한 번 내보낸 뒤 기록을
 * 멈춘다(중계는 호출자가 계속한다). 한 프레임 끝에서 잘린 UTF-8 글자는 다음 꺼내기까지 남겨 깨지지 않게 한다.
 *
 * <p>봉인(WP-2014): 마지막 꺼내기({@code drain(true)}) 뒤에는 {@link #append} 가 false 를 돌려주고 아무것도 더하지 않는다 — 닫는
 * 순간 도착한 입력이 마지막 꺼내기 뒤에 버퍼에 남아 조용히 사라지는 일을 호출자가 알 수 있게 한다. 되돌려 넣기: DB 쓰기에 실패한 덩어리는 {@link #requeue}
 * 로 돌려놓아 다음 꺼내기의 맨 앞에서 순서 그대로 다시 나가게 한다.
 */
final class ScreenInputRecorder {

  /** 세션당 기록 상한 — 1MB. */
  static final int CAP_BYTES = 1024 * 1024;

  /** 상한을 넘은 뒤 한 번 남기는 표시 행. */
  static final String CAP_MARKER = "[기록 상한 — 이후 입력은 기록하지 않음]";

  private final ByteArrayOutputStream pending = new ByteArrayOutputStream();
  private long recorded;
  private boolean capped;
  private boolean markerPending;

  /** 저장에 실패해 되돌려 넣은 덩어리 — 다음 꺼내기 때 새 덩어리보다 먼저 나간다. */
  private final ArrayDeque<String> requeued = new ArrayDeque<>();

  /** 마지막 꺼내기를 마쳤는지 — true 면 더 받지 않는다. */
  private boolean sealed;

  /**
   * 넘긴 입력을 버퍼에 더한다. 상한을 넘으면 남는 만큼만 받고 이후는 버린다.
   *
   * @return 봉인됐으면 false(아무것도 더하지 않음). 그 밖에는 true — 상한 뒤라 기록하지 않아도 true 이며 호출자는 중계를 계속한다.
   */
  synchronized boolean append(byte[] data) {
    if (sealed) return false;
    if (capped) return true;
    long room = CAP_BYTES - recorded;
    int take = (int) Math.min(room, data.length);
    pending.write(data, 0, take);
    recorded += take;
    if (take < data.length || recorded >= CAP_BYTES) {
      capped = true;
      markerPending = true;
    }
    return true;
  }

  /**
   * 저장에 실패한 덩어리를 다음 꺼내기의 맨 앞에 순서 그대로 되돌려 놓는다.
   *
   * @return 이미 봉인됐으면 false(받지 않음 — 호출자가 처리), 아니면 true.
   */
  synchronized boolean requeue(List<String> chunks) {
    if (sealed) return false;
    // 앞쪽에 순서대로 끼우려면 거꾸로 addFirst 한다(이미 되돌려 둔 것이 있으면 그보다도 앞).
    for (int i = chunks.size() - 1; i >= 0; i--) {
      requeued.addFirst(chunks.get(i));
    }
    return true;
  }

  /**
   * 지금까지 모은 것을 저장할 글자 덩어리로 꺼낸다(없으면 빈 목록). {@code finalFlush} 가 아니면 끝에서 잘린 UTF-8 글자는 남겨 둔다. 상한에 막
   * 닿았으면 표시 행이 뒤에 붙는다. 되돌려 넣은 덩어리가 있으면 그것이 맨 앞에 먼저 나온다. {@code finalFlush} 면 꺼낸 뒤 봉인한다.
   */
  synchronized List<String> drain(boolean finalFlush) {
    // 보기 전용 화면은 매초 빈 버퍼다 — 복사하지 않고 끝낸다.
    if (pending.size() == 0 && !markerPending && requeued.isEmpty()) {
      if (finalFlush) sealed = true;
      return List.of();
    }
    List<String> out = new ArrayList<>(requeued.size() + 2);
    out.addAll(requeued);
    requeued.clear();
    byte[] bytes = pending.toByteArray();
    int cut = (finalFlush || markerPending) ? bytes.length : completeLength(bytes);
    if (cut > 0) {
      out.add(escape(Arrays.copyOf(bytes, cut)));
      pending.reset();
      pending.write(bytes, cut, bytes.length - cut);
    }
    if (markerPending) {
      out.add(CAP_MARKER);
      markerPending = false;
    }
    if (finalFlush) sealed = true;
    return out;
  }

  /** 끝에 잘린 UTF-8 글자가 있으면 그 앞까지의 길이. */
  static int completeLength(byte[] b) {
    int n = b.length;
    for (int back = 1; back <= Math.min(4, n); back++) {
      int i = n - back;
      int v = b[i] & 0xFF;
      if ((v & 0xC0) == 0x80) continue; // 이어지는 바이트 — 더 앞의 첫 바이트를 찾는다
      int need = (v & 0xE0) == 0xC0 ? 2 : (v & 0xF0) == 0xE0 ? 3 : (v & 0xF8) == 0xF0 ? 4 : 1;
      return back < need ? i : n;
    }
    return n;
  }

  /** UTF-8 로 읽고(깨진 바이트는 대체 문자) 제어 문자·역슬래시를 표기로 바꾼다. */
  static String escape(byte[] bytes) {
    CharsetDecoder dec =
        StandardCharsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE);
    CharBuffer chars;
    try {
      chars = dec.decode(ByteBuffer.wrap(bytes));
    } catch (CharacterCodingException e) {
      throw new IllegalStateException(e); // REPLACE 라 오지 않는다
    }
    StringBuilder sb = new StringBuilder(chars.length() + 8);
    while (chars.hasRemaining()) {
      char c = chars.get();
      if (c == '\\') {
        sb.append("\\\\");
      } else if (c < 0x20 || c == 0x7F || (c >= 0x80 && c <= 0x9F)) {
        sb.append(String.format("\\x%02x", (int) c));
      } else {
        sb.append(c);
      }
    }
    return sb.toString();
  }
}
