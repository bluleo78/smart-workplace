package com.workplace.contacts.exception;

/**
 * 외부 연락처 생성/수정 시 동일 이름+이메일 조합이 이미 존재함을 알리는 소프트 경고.
 *
 * <p>#688(채팅 채널)/#696(Wiki·Drive 팀 스페이스)/#803(연락처 조직 그룹) 등 "컨테이너" 류와 달리, 연락처는 사람이 자유 입력하는 레코드라
 * 동명이인·조직 공유 이메일이 현실에 존재할 수 있어 하드 차단하지 않는다. 409 로 응답해 프론트가 확인 다이얼로그를 띄우고, 사용자가 강행(force=true)하면 그대로
 * 저장을 허용한다.
 */
public class ContactDuplicateWarningException extends RuntimeException {
  public ContactDuplicateWarningException(String name) {
    super("이미 존재하는 연락처입니다: " + name);
  }
}
