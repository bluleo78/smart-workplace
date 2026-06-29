package com.workplace.global.util;

import java.text.Normalizer;

/**
 * 사용자 제공 이름(파일명·폴더명·검색어)의 유니코드 정규화 유틸.
 *
 * <p>macOS(HFS+/APFS)는 한글 파일명을 NFD(자모 분해형)로 전달하는 반면, 키보드 입력·웹·DB 텍스트·문서 본문은 NFC(정준 합성형)다. 정규화하지 않으면
 * {@code ILIKE} 바이트 비교에서 NFD 저장값과 NFC 검색어가 영구히 불일치한다(예: 맥에서 올린 "이력서.pdf" 가 검색되지 않음). 모든 쓰기·검색 경계에서
 * NFC 로 통일한다.
 */
public final class UnicodeNames {

  private UnicodeNames() {}

  /** 입력을 NFC(정준 합성형)로 정규화. null 은 그대로 통과. */
  public static String toNfc(String s) {
    return s == null ? null : Normalizer.normalize(s, Normalizer.Form.NFC);
  }
}
