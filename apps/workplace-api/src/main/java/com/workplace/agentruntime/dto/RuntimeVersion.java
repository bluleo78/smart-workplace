package com.workplace.agentruntime.dto;

/**
 * 작업 공간 AI 를 띄우는 데 쓰는 릴리스 버전(WP-1706) — 템플릿 이미지와 genia-works 플러그인 버전. 실행 설정에 「지금 generation 을 띄운
 * 버전」으로 적어 두었다가, 릴리스가 바뀌면 달라진 것을 알아본다.
 *
 * @param image 작업 공간 이미지(저장소@sha256:… 또는 버전 태그)
 * @param pluginVersion 플러그인 버전. 모르면(배포가 넘기지 않음) null — 비교에서 빠진다.
 */
public record RuntimeVersion(String image, String pluginVersion) {

  /** 로그용 표기 — {@code image=… plugin=…}(플러그인을 모르면 {@code -}). */
  public String label() {
    return "image=" + image + " plugin=" + (pluginVersion == null ? "-" : pluginVersion);
  }
}
