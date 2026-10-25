package com.workplace.mail.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * WP-962 메일 옮기기 요청 — 보관·메일함으로 옮기기·삭제(서버 휴지통으로 옮기기)를 한 형태로 받는다.
 *
 * @param messageIds 옮길 메일(1~{@value #MAX_MESSAGES}통, 모두 같은 계정)
 * @param target 옮길 곳
 */
public record MailMoveRequest(
    @NotEmpty @Size(max = MailMoveRequest.MAX_MESSAGES) List<@NotNull Long> messageIds,
    @NotNull @Valid Target target) {

  /** 한 번에 옮길 수 있는 메일 수 상한. */
  public static final int MAX_MESSAGES = 100;

  /** 옮길 곳 종류. */
  public enum Kind {
    /** 받은편지함. */
    INBOX,
    /** 계정의 보관 메일함. */
    ARCHIVE,
    /** 서버 휴지통(영구 삭제 아님). */
    TRASH,
    /** 저장된 서버 메일함(보관·내 메일함) — folderId 필수. */
    FOLDER
  }

  /**
   * 옮길 곳.
   *
   * @param kind 종류
   * @param folderId kind=FOLDER 일 때 email_folder id
   */
  public record Target(@NotNull Kind kind, Long folderId) {}
}
