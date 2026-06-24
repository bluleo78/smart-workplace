package com.workplace.mail.dto;

import java.util.List;

/** 초안 코칭 응답(미영속): 전체 글 코칭 노트 + 다듬은 개선본 HTML. */
public record MailDraftCoaching(List<CoachingNote> notes, String improvedBodyHtml) {}
