package com.workplace.global.util;

import java.util.regex.Pattern;

/**
 * 한 줄 제목 정규화(WP-601) — 노트 페이지 제목처럼 트리·탭·검색 결과에 한 줄로 그려지는 제목. 공백만 남은 제목이 빈 줄로 보이거나, 줄바꿈이 들어가 트리 행이 두
 * 줄로 깨지지 않게 저장 전에 다듬는다. 빈 제목 자체는 허용한다(화면이 「제목 없음」으로 보여 준다).
 */
public final class SingleLineTitles {
  private SingleLineTitles() {}

  /** 줄을 바꾸는 문자 — 제어 문자(줄바꿈·탭 등 C0·C1)와 줄/문단 구분자. 공백 하나로 바꾼다. */
  private static final Pattern LINE_BREAKS = Pattern.compile("[\\p{Cc}\\u2028\\u2029]+");

  /**
   * 양방향 제어 문자(U+202A–202E 포함 U+202E RLO, U+2066–2069) — 제목 한가운데에 있으면 뒤 글자의 표시 순서가 뒤집혀(「abc」→「cba」)
   * 제목을 속여 보이게 할 수 있다(WP-908). 사람 이름({@link PersonNames})은 거절하지만 제목은 저장 전에 조용히 지운다 — 줄바꿈과 같은 쪽(다듬어
   * 저장)이다.
   */
  private static final Pattern BIDI_CONTROLS = Pattern.compile("[\\u202A-\\u202E\\u2066-\\u2069]");

  /** 앞뒤의 보이지 않는 문자(공백류·제로폭·한글 채움) — 사람 이름과 같은 범위({@link PersonNames}). */
  private static final Pattern INVISIBLE_EDGES =
      Pattern.compile(
          "^" + PersonNames.INVISIBLE_CLASS + "+|" + PersonNames.INVISIBLE_CLASS + "+$");

  /**
   * NFC 로 맞추고 양방향 제어 문자를 지우고 줄바꿈·탭을 공백 하나로 바꾼 뒤 앞뒤의 보이지 않는 문자를 지운다. 그려지는 글자가 없으면(결합 문자·변형 선택자만 남은
   * 경우 포함, WP-724) 빈 문자열 — 호출 쪽의 「입력해 주세요」 검증이 그대로 거절한다. null 은 그대로(「제목 유지」 요청).
   */
  public static String normalize(String raw) {
    if (raw == null) return null;
    String noBidi = BIDI_CONTROLS.matcher(UnicodeNames.toNfc(raw)).replaceAll("");
    String oneLine = LINE_BREAKS.matcher(noBidi).replaceAll(" ");
    String trimmed = INVISIBLE_EDGES.matcher(oneLine).replaceAll("");
    return PersonNames.hasVisibleChar(trimmed) ? trimmed : "";
  }
}
