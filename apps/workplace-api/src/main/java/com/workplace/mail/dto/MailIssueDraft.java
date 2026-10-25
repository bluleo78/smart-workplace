package com.workplace.mail.dto;

import java.util.List;

/**
 * #520 메일→이슈 초안(미영속). candidateProjects 는 사용자의 멤버 프로젝트(드롭다운 소스).
 *
 * <p>WP-954: sender 는 보낸 사람이 이 워크스페이스 구성원인지(보고자 「보낸 사람」 선택지), 후보 프로젝트마다 보낸 사람을 보고자로 고를 수 있는지·기본으로
 * 고를지를 싣는다 — 모달이 프로젝트를 바꿀 때마다 서버를 다시 부르지 않고 기본값을 정한다.
 */
public record MailIssueDraft(
    String title,
    String body,
    String priority,
    String suggestedProjectKey,
    List<CandidateProject> candidateProjects,
    DraftSender sender) {

  /**
   * 프로젝트 드롭다운 항목. senderSelectable = 보낸 사람이 이 프로젝트를 볼 수 있어 보고자로 고를 수 있음, senderDefault = 보낸 사람이 이
   * 프로젝트 멤버이거나 OPEN 프로젝트라 보고자 기본값이 「보낸 사람」(WP-954).
   */
  public record CandidateProject(
      String key, String name, boolean senderSelectable, boolean senderDefault) {}

  /**
   * 보낸 사람(WP-954). member = 이 워크스페이스의 활성 사람 구성원(나 제외), self = 내가 보낸 메일. name 은 구성원이면 구성원 이름, 아니면
   * null.
   */
  public record DraftSender(String address, String name, boolean member, boolean self) {}
}
