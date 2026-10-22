package com.workplace.wiki.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.Size;

/**
 * 노트 저장 요청.
 *
 * @param title null 이면 제목 유지. 제목은 버전 검사 없이 나중 값 우선(WP-290). 받을 때 한 줄로 다듬는다 — 공백뿐이면 빈 제목(WP-601)
 * @param body null 이면 본문 유지. 100만 자까지(WP-625) — 상한이 없어 약 10MB 본문이 저장되고 그 페이지를 열 때마다 수 MB 가 내려갔다. 이
 *     경로는 AI 도구(update_wiki_page)가 쓰므로 한 번의 실수로 큰 글이 붙지 않게 막는다
 * @param version 본문을 낙관적으로 저장할 때의 기준 version. 동시 편집 도입(WP-290) 후 제목만 바꾸는 요청에는 필요 없어 nullable — 동기화
 *     서버가 꺼진 기존 저장 경로에서 본문을 보낼 때만 서비스가 필수로 검사한다
 * @param fullWidth null 이면 「전체 폭」 설정 유지(WP-793). 본문 폭을 읽기 폭 대신 화면 폭 전체로 보일지 — 제목처럼 버전 검사 없이 나중 값
 *     우선이고, 보기 설정이라 본문 version·수정자·수정 시각·버전 기록을 건드리지 않는다. 본문 없는 요청에서만 반영한다(본문과 함께 오면 무시 — 웹 ⋯ 메뉴만
 *     보낸다)
 * @param snapshot 무시한다(구버전 웹·PWA 호환으로 받기만 함, 판정 R8) — 리비전은 서버가 시간 규칙(5분 정적·30분)과 AI·복원 적용으로 판단한다
 */
public record SavePageRequest(
    @Size(max = 255) String title,
    @Size(max = BODY_MAX, message = "노트 본문은 1,000,000자 이하여야 합니다") String body,
    Integer version,
    boolean snapshot,
    Boolean fullWidth) {
  /** 본문 최대 글자 수 — 문서 수백 쪽 분량. 이미지는 첨부로 따로 올라가 본문엔 주소만 들어간다. */
  public static final int BODY_MAX = 1_000_000;

  public SavePageRequest {
    title = SingleLineTitles.normalize(title);
  }

  /** 「전체 폭」 없이 만드는 호환 생성자(WP-793) — 제목·본문 저장만 하는 기존 호출처(복원·MCP·테스트)용. fullWidth 는 유지(null). */
  public SavePageRequest(String title, String body, Integer version, boolean snapshot) {
    this(title, body, version, snapshot, null);
  }
}
