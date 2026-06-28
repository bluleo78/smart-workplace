package com.workplace.mail.dto;

import java.util.List;

/** #520 메일→이슈 초안(미영속). candidateProjects 는 사용자의 멤버 프로젝트(드롭다운 소스). */
public record MailIssueDraft(
    String title,
    String body,
    String priority,
    String suggestedProjectKey,
    List<CandidateProject> candidateProjects) {

  /** 프로젝트 드롭다운 항목. */
  public record CandidateProject(String key, String name) {}
}
