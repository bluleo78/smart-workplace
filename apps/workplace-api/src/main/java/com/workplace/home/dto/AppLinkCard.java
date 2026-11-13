package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.drive.service.DriveShareTarget;
import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * 채팅 본문의 우리 앱 링크 카드(WP-896) — 링크를 보는 사람의 권한으로 그 순간 채운다(저장하지 않는다). 종류마다 쓰는 칸만 싣는다(NON_NULL — 비운 칸은
 * 응답 JSON 에 키조차 없다).
 *
 * @param kind ISSUE | PAGE | FILE | MESSAGE | EVENT | MAIL | SHARE | FOLDER | DRIVE_SPACE
 * @param title 이슈 제목 / 노트 제목 / 파일 이름 / 메시지 본문 미리보기 / 일정 제목 / 메일 제목 / FOLDER — 폴더 이름 / DRIVE_SPACE —
 *     드라이브 공간 이름 / SHARE(MEMBER·OPEN) — 파일 이름, SHARE(PASSWORD) — 고정 문구 {@link
 *     #SHARE_PASSWORD_TITLE}
 * @param issueKey ISSUE — KEY-N
 * @param statusName ISSUE — 상태 이름
 * @param statusCategory ISSUE — 상태 범주(TODO·IN_PROGRESS·DONE·CANCELED — 배지 색, 다른 이슈 화면과 같다)
 * @param assignees ISSUE — 담당자
 * @param priority ISSUE — 우선순위(HIGHEST·HIGH·MID·LOW·LOWEST)
 * @param spaceName PAGE — 노트 스페이스 이름 / SHARE(MEMBER) — 파일이 있는 드라이브 공간 이름 / FOLDER — 폴더가 있는 드라이브 공간
 *     이름
 * @param channelName MESSAGE — 채널 이름. DM 이면 보는 사람 기준 상대 이름(대화 목록과 같은 표기)
 * @param channelKind MESSAGE — CHANNEL | DM
 * @param authorName MESSAGE — 보낸 사람 이름 / MAIL — 보낸 사람 표시 이름(없으면 주소)
 * @param sentAt MESSAGE — 보낸 시각 / MAIL — 메일 날짜(Date 헤더, 없으면 받은 시각)
 * @param startAt EVENT — 시작 시각
 * @param endAt EVENT — 끝 시각
 * @param allDay EVENT — 종일 일정인지
 * @param shareState SHARE — MEMBER | OPEN | PASSWORD(WP-1474). 열 수 없는 링크는 카드가 아니라 410 이다
 * @param mimeType SHARE(MEMBER·OPEN) — 파일 형식
 * @param typeLabel SHARE(OPEN) — 사람이 읽는 종류 이름(메신저 미리보기 카드와 같은 표기)
 * @param sizeBytes SHARE(OPEN) — 파일 크기
 * @param expiresAt SHARE(OPEN) — 링크 만료 시각(만료일 없는 링크면 없음)
 * @param driveSpaceId SHARE(MEMBER) — 드라이브 공간 id
 * @param driveFolderId SHARE(MEMBER) — 파일이 든 폴더 id(루트면 없음)
 * @param driveFileId SHARE(MEMBER) — 드라이브 파일 id
 * @param shareTarget SHARE — FILE | FOLDER(WP-1538, SHARE 카드면 늘 싣는다. JSON 은 enum 이름 문자열)
 * @param audience SHARE(폴더 MEMBER·OPEN) — EXTERNAL | INTERNAL
 * @param folderCount SHARE(폴더 MEMBER·OPEN) — 공유 폴더 바로 아래 폴더 수
 * @param fileCount SHARE(폴더 MEMBER·OPEN) — 공유 폴더 바로 아래 파일 수
 * @param sharedBy SHARE(폴더 MEMBER·OPEN) — 링크를 만든 사람 이름
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AppLinkCard(
    String kind,
    String title,
    String issueKey,
    String statusName,
    String statusCategory,
    List<UserSummary> assignees,
    String priority,
    String spaceName,
    String channelName,
    String channelKind,
    String authorName,
    Instant sentAt,
    Instant startAt,
    Instant endAt,
    Boolean allDay,
    String shareState,
    String mimeType,
    String typeLabel,
    Long sizeBytes,
    Instant expiresAt,
    Long driveSpaceId,
    Long driveFolderId,
    Long driveFileId,
    DriveShareTarget shareTarget,
    String audience,
    Integer folderCount,
    Integer fileCount,
    String sharedBy) {

  /** 비밀번호 공유 링크 카드의 제목(WP-1474) — 파일 이름 대신 쓰는, 아무것도 드러내지 않는 고정 문구. */
  public static final String SHARE_PASSWORD_TITLE = "비밀번호로 보호된 공유 파일";

  /** 비밀번호 공유 폴더 링크 카드의 제목(WP-1538) — 폴더 이름 대신 쓰는 고정 문구. */
  public static final String SHARE_FOLDER_PASSWORD_TITLE = "비밀번호로 보호된 공유 폴더";

  /** 이슈 카드. */
  public static AppLinkCard issue(
      String issueKey,
      String title,
      String statusName,
      String statusCategory,
      List<UserSummary> assignees,
      String priority) {
    Builder b = new Builder("ISSUE", title);
    b.issueKey = issueKey;
    b.statusName = statusName;
    b.statusCategory = statusCategory;
    b.assignees = assignees;
    b.priority = priority;
    return b.build();
  }

  /** 노트 카드. */
  public static AppLinkCard page(String title, String spaceName) {
    Builder b = new Builder("PAGE", title);
    b.spaceName = spaceName;
    return b.build();
  }

  /** 파일 카드. */
  public static AppLinkCard file(String name) {
    return new Builder("FILE", name).build();
  }

  /** 드라이브 폴더 카드(WP-1536) — 폴더 이름과 그 폴더가 있는 공간 이름. */
  public static AppLinkCard folder(String name, String spaceName) {
    Builder b = new Builder("FOLDER", name);
    b.spaceName = spaceName;
    return b.build();
  }

  /** 드라이브 공간 카드(WP-1536) — 공간 첫 화면 링크(/drive/spaces/{id}). 제목이 곧 공간 이름이라 다른 칸은 없다. */
  public static AppLinkCard driveSpace(String name) {
    return new Builder("DRIVE_SPACE", name).build();
  }

  /** 채널·DM 메시지 카드(WP-1236) — 본문 미리보기·대화 이름·보낸 사람·보낸 시각. */
  public static AppLinkCard message(
      String preview, String channelName, String channelKind, String authorName, Instant sentAt) {
    Builder b = new Builder("MESSAGE", preview);
    b.channelName = channelName;
    b.channelKind = channelKind;
    b.authorName = authorName;
    b.sentAt = sentAt;
    return b.build();
  }

  /** 일정 카드(WP-1236) — 제목·시작·끝·종일 여부. */
  public static AppLinkCard event(String title, Instant startAt, Instant endAt, boolean allDay) {
    Builder b = new Builder("EVENT", title);
    b.startAt = startAt;
    b.endAt = endAt;
    b.allDay = allDay;
    return b.build();
  }

  /** 메일 카드(WP-1236) — 제목·보낸 사람·메일 날짜. 본문은 싣지 않는다. */
  public static AppLinkCard mail(String subject, String fromName, Instant sentAt) {
    Builder b = new Builder("MAIL", subject);
    b.authorName = fromName;
    b.sentAt = sentAt;
    return b.build();
  }

  /**
   * 공유 링크 카드 — 보는 사람이 파일 공간의 구성원(WP-1474). 드라이브의 그 파일로 가도록 공간·폴더·파일 id 를 싣는다.
   *
   * @param folderId 루트면 null(응답에서 빠진다)
   */
  public static AppLinkCard shareMember(
      String name, String mimeType, String spaceName, long spaceId, Long folderId, long fileId) {
    Builder b = new Builder("SHARE", name);
    b.shareState = "MEMBER";
    b.mimeType = mimeType;
    b.spaceName = spaceName;
    b.driveSpaceId = spaceId;
    b.driveFolderId = folderId;
    b.driveFileId = fileId;
    b.shareTarget = DriveShareTarget.FILE;
    return b.build();
  }

  /**
   * 공유 링크 카드 — 구성원이 아니지만 링크로 열 수 있다(WP-1474). 이름·형식·종류 이름·크기·만료일만 — 공간·위치는 싣지 않는다.
   *
   * @param expiresAt 만료일 없는 링크면 null(응답에서 빠진다)
   */
  public static AppLinkCard shareOpen(
      String name, String mimeType, String typeLabel, long sizeBytes, Instant expiresAt) {
    Builder b = new Builder("SHARE", name);
    b.shareState = "OPEN";
    b.mimeType = mimeType;
    b.typeLabel = typeLabel;
    b.sizeBytes = sizeBytes;
    b.expiresAt = expiresAt;
    b.shareTarget = DriveShareTarget.FILE;
    return b.build();
  }

  /** 공유 링크 카드 — 보는 사람이 공유 폴더 공간의 구성원(WP-1538). 드라이브의 그 폴더로 가도록 공간·폴더 id 를 싣는다(폴더는 공유 폴더 자신). */
  public static AppLinkCard shareFolderMember(
      String name,
      String spaceName,
      long spaceId,
      long folderId,
      String audience,
      int folderCount,
      int fileCount,
      String sharedBy) {
    Builder b = new Builder("SHARE", name);
    b.shareState = "MEMBER";
    b.shareTarget = DriveShareTarget.FOLDER;
    b.spaceName = spaceName;
    b.driveSpaceId = spaceId;
    b.driveFolderId = folderId;
    b.audience = audience;
    b.folderCount = folderCount;
    b.fileCount = fileCount;
    b.sharedBy = sharedBy;
    return b.build();
  }

  /**
   * 공유 링크 카드 — 구성원이 아니지만 링크로 열 수 있는 폴더(WP-1538). 이름·대상 범위·바로 아래 수·공유한 사람·만료일만 — 공간·위치는 싣지 않는다.
   *
   * @param expiresAt 만료일 없는 링크면 null(응답에서 빠진다)
   */
  public static AppLinkCard shareFolderOpen(
      String name,
      String audience,
      int folderCount,
      int fileCount,
      String sharedBy,
      Instant expiresAt) {
    Builder b = new Builder("SHARE", name);
    b.shareState = "OPEN";
    b.shareTarget = DriveShareTarget.FOLDER;
    b.audience = audience;
    b.folderCount = folderCount;
    b.fileCount = fileCount;
    b.sharedBy = sharedBy;
    b.expiresAt = expiresAt;
    return b.build();
  }

  /**
   * 공유 링크 카드 — 비밀번호 링크(WP-1474). 파일 정보를 하나도 싣지 않고 제목은 아무것도 드러내지 않는 고정 문구다(잠긴 내용이 응답으로 새지 않게, 그래도 모든
   * 카드에 title 이 있게).
   */
  public static AppLinkCard sharePassword(DriveShareTarget target) {
    Builder b =
        new Builder(
            "SHARE",
            target == DriveShareTarget.FOLDER ? SHARE_FOLDER_PASSWORD_TITLE : SHARE_PASSWORD_TITLE);
    b.shareState = "PASSWORD";
    b.shareTarget = target;
    return b.build();
  }

  /**
   * 카드 생성 도우미 — 종류·제목만 정한 빈 카드에서 시작해 그 종류가 쓰는 칸만 채운다. 칸이 많아 위치 인자 생성자를 팩토리마다 쓰면 null 자리를 헤아려야 해서
   * 읽기·고치기 어렵다.
   */
  private static final class Builder {
    private final String kind;
    private final String title;
    private String issueKey;
    private String statusName;
    private String statusCategory;
    private List<UserSummary> assignees;
    private String priority;
    private String spaceName;
    private String channelName;
    private String channelKind;
    private String authorName;
    private Instant sentAt;
    private Instant startAt;
    private Instant endAt;
    private Boolean allDay;
    private String shareState;
    private String mimeType;
    private String typeLabel;
    private Long sizeBytes;
    private Instant expiresAt;
    private Long driveSpaceId;
    private Long driveFolderId;
    private Long driveFileId;
    private DriveShareTarget shareTarget;
    private String audience;
    private Integer folderCount;
    private Integer fileCount;
    private String sharedBy;

    private Builder(String kind, String title) {
      this.kind = kind;
      this.title = title;
    }

    private AppLinkCard build() {
      return new AppLinkCard(
          kind,
          title,
          issueKey,
          statusName,
          statusCategory,
          assignees,
          priority,
          spaceName,
          channelName,
          channelKind,
          authorName,
          sentAt,
          startAt,
          endAt,
          allDay,
          shareState,
          mimeType,
          typeLabel,
          sizeBytes,
          expiresAt,
          driveSpaceId,
          driveFolderId,
          driveFileId,
          shareTarget,
          audience,
          folderCount,
          fileCount,
          sharedBy);
    }
  }
}
