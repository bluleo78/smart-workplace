package com.workplace.agentruntime.screen;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 세션 하나의 입력 기록 버퍼(WP-1277) — runner 로 넘긴 키 입력 바이트를 모았다가 약 1초마다 한 덩어리 글자로 꺼낸다. 저장 형식은 UTF-8 글자 그대로,
 * 제어 문자는 {@code \x1b} 같은 표기, 역슬래시는 {@code \\}.
 *
 * <p>세션당 {@link #CAP_BYTES} 까지만 기록한다. 넘으면 그 앞까지만 남기고 표시 행 {@link #CAP_MARKER} 를 한 번 내보낸 뒤 기록을
 * 멈춘다(중계는 호출자가 계속한다). 한 프레임 끝에서 잘린 UTF-8 글자는 다음 꺼내기까지 남겨 깨지지 않게 한다.
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

  /** 넘긴 입력을 버퍼에 더한다. 상한을 넘으면 남는 만큼만 받고 이후는 버린다. */
  synchronized void append(byte[] data) {
    if (capped) return;
    long room = CAP_BYTES - recorded;
    int take = (int) Math.min(room, data.length);
    pending.write(data, 0, take);
    recorded += take;
    if (take < data.length || recorded >= CAP_BYTES) {
      capped = true;
      markerPending = true;
    }
  }

  /**
   * 지금까지 모은 것을 저장할 글자 덩어리로 꺼낸다(없으면 빈 목록). {@code finalFlush} 가 아니면 끝에서 잘린 UTF-8 글자는 남겨 둔다. 상한에 막
   * 닿았으면 표시 행이 뒤에 붙는다.
   */
  synchronized List<String> drain(boolean finalFlush) {
    // 보기 전용 화면은 매초 빈 버퍼다 — 복사하지 않고 끝낸다.
    if (pending.size() == 0 && !markerPending) return List.of();
    List<String> out = new ArrayList<>(2);
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
