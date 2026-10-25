package com.workplace.mail.service.folder;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * IMAP LIST 결과를 역할(받은편지함·시스템·보관·사용자)로 나누고 저장 대상 폴더만 고르는 순수 로직(WP-960). 네트워크·DB 를 쓰지 않아 단위 테스트로 규칙을
 * 직접 검증한다.
 *
 * <p>판별 순서: (1) INBOX(대소문자 무시) (2) Gmail 의 {@code [Gmail]}·{@code [Google Mail]} 과 그 하위 — 사용자 라벨이
 * 아니라 숨김 (3) SPECIAL-USE 속성(\Archive → 보관, \Sent·\Drafts·\Trash·\Junk·\All·\Flagged·\Important →
 * 시스템) (4) 속성이 없을 때 이름 — 최상위나 INBOX 바로 아래 폴더에만 적용한다(아래 참고) (5) 나머지는 사용자 메일함.
 *
 * <p>이름 판별을 최상위·INBOX 바로 아래로 한정한 이유: 서버가 속성을 주지 않을 때 시스템 폴더는 그 위치에만 만들어진다(Dovecot 기본, Courier·Cyrus
 * 의 {@code INBOX.Sent}). 깊은 곳의 「고객사/Trash」「프로젝트/Archive」는 사용자가 만든 폴더라 숨기거나 두 번째 보관함으로 만들면 안 된다.
 */
public final class ImapFolderClassifier {

  /** 판별 결과. INBOX·SYSTEM 은 저장하지 않는다. */
  public enum Kind {
    INBOX,
    SYSTEM,
    ARCHIVE,
    USER
  }

  /**
   * LIST 한 항목.
   *
   * @param fullName 서버 전체 경로(getFullName)
   * @param separator 계층 구분자 — 평면 이름공간이면 {@code '\0'}
   * @param attributes LIST 속성(예: {@code \HasNoChildren}, {@code \Archive}) — 대소문자 무관
   * @param holdsMessages 메일을 담을 수 있는지(\Noselect·\NonExistent 가 아니고 HOLDS_MESSAGES)
   */
  public record Entry(
      String fullName, char separator, List<String> attributes, boolean holdsMessages) {}

  /** \Archive 표시. */
  private static final String ATTR_ARCHIVE = "\\archive";

  /** 시스템 폴더 SPECIAL-USE 표시(RFC 6154 + Gmail 확장). */
  private static final Set<String> SYSTEM_ATTRS =
      Set.of("\\sent", "\\drafts", "\\trash", "\\junk", "\\all", "\\flagged", "\\important");

  /** 속성이 없을 때 보관함으로 보는 이름(소문자). */
  private static final Set<String> ARCHIVE_NAMES = Set.of("archive", "archives", "보관", "보관함");

  /** 속성이 없을 때 시스템 폴더로 보는 이름(소문자). */
  private static final Set<String> SYSTEM_NAMES =
      Set.of(
          "sent",
          "sent items",
          "sent messages",
          "sent mail",
          "보낸편지함",
          "보낸 메일함",
          "drafts",
          "임시보관함",
          "trash",
          "deleted",
          "deleted items",
          "deleted messages",
          "휴지통",
          "junk",
          "junk e-mail",
          "junk email",
          "spam",
          "스팸",
          "스팸메일함",
          "outbox",
          "보낼편지함");

  /** Gmail 시스템 묶음 폴더 이름(소문자) — 그 하위 전체가 시스템 라벨이다. */
  private static final Set<String> GMAIL_ROOTS = Set.of("[gmail]", "[google mail]");

  private ImapFolderClassifier() {}

  /** 한 항목의 역할을 판별한다. 계층(부모)과 무관한 자기 자신만의 판별이다. */
  public static Kind kindOf(Entry e) {
    List<String> segments = segments(e);
    if ("INBOX".equalsIgnoreCase(e.fullName())) {
      return Kind.INBOX;
    }
    if (GMAIL_ROOTS.contains(segments.get(0).toLowerCase(Locale.ROOT))) {
      return Kind.SYSTEM;
    }
    // SPECIAL-USE 속성이 이름보다 우선한다 — 서버가 직접 알려 준 역할이다.
    for (String attr : e.attributes()) {
      String a = attr.toLowerCase(Locale.ROOT);
      if (ATTR_ARCHIVE.equals(a)) {
        return Kind.ARCHIVE;
      }
      if (SYSTEM_ATTRS.contains(a)) {
        return Kind.SYSTEM;
      }
    }
    // 이름 판별은 최상위 또는 INBOX 바로 아래에만(클래스 주석 참고).
    boolean nameCheckable =
        segments.size() == 1 || (segments.size() == 2 && "INBOX".equalsIgnoreCase(segments.get(0)));
    if (nameCheckable) {
      String last = segments.get(segments.size() - 1).trim().toLowerCase(Locale.ROOT);
      if (ARCHIVE_NAMES.contains(last)) {
        return Kind.ARCHIVE;
      }
      if (SYSTEM_NAMES.contains(last)) {
        return Kind.SYSTEM;
      }
    }
    return Kind.USER;
  }

  /**
   * LIST 결과 전체에서 저장 대상(ARCHIVE·USER)을 골라 계층을 붙인다. 개수(unread·total)는 비워 둔다 — STATUS 는 호출자가 고른 폴더에만
   * 보낸다.
   *
   * <p>메일을 담지 못하는 폴더(\Noselect)는 보이는 자식(메일을 담는 보관·사용자 폴더)이 하위 어딘가에 있을 때만 selectable=false 로 남긴다 —
   * 트리의 묶음 노드 역할만 한다. 부모가 받은편지함·시스템 폴더면 parentKey 를 null 로 둬 내 메일함 최상위로 올린다.
   */
  public static List<ServerFolder> classify(List<Entry> entries) {
    Map<String, Entry> byName = new LinkedHashMap<>();
    Map<String, Kind> kinds = new LinkedHashMap<>();
    for (Entry e : entries) {
      byName.put(e.fullName(), e);
      kinds.put(e.fullName(), kindOf(e));
    }

    // 1) 메일을 담는 보관·사용자 폴더는 그대로 남기고, 그 조상 중 보관·사용자 폴더(묶음 노드 포함)도 남긴다(하위에서 위로).
    Set<String> kept = new HashSet<>();
    for (Entry e : entries) {
      if (!isVisibleKind(kinds.get(e.fullName())) || !e.holdsMessages()) {
        continue;
      }
      kept.add(e.fullName());
      String parent = parentPath(e);
      while (parent != null && byName.containsKey(parent) && isVisibleKind(kinds.get(parent))) {
        if (!kept.add(parent)) {
          break; // 이미 위쪽까지 표시됨
        }
        parent = parentPath(byName.get(parent));
      }
    }

    // 2) 남긴 폴더를 LIST 순서대로 공급자 중립 표현으로 바꾼다. 부모는 남긴 폴더일 때만 연결한다.
    List<ServerFolder> out = new ArrayList<>();
    for (Entry e : entries) {
      if (!kept.contains(e.fullName())) {
        continue;
      }
      String parent = parentPath(e);
      String parentKey = parent != null && kept.contains(parent) ? parent : null;
      List<String> segs = segments(e);
      FolderRole role =
          kinds.get(e.fullName()) == Kind.ARCHIVE ? FolderRole.ARCHIVE : FolderRole.USER;
      out.add(
          new ServerFolder(
              e.fullName(),
              e.fullName(),
              segs.get(segs.size() - 1),
              parentKey,
              role,
              e.holdsMessages(),
              null,
              null));
    }
    return out;
  }

  /** \Trash 표시. */
  private static final String ATTR_TRASH = "\\trash";

  /** 속성이 없을 때 휴지통으로 보는 이름(소문자) — 시스템 폴더 이름 판별과 같은 위치(최상위·INBOX 바로 아래·Gmail 묶음 바로 아래)에만. */
  private static final List<String> TRASH_NAMES =
      List.of("trash", "deleted items", "deleted messages", "deleted", "휴지통", "bin");

  /**
   * LIST 결과에서 서버 휴지통 폴더의 전체 경로를 찾는다(WP-962 — 앱에서 지운 메일을 옮길 곳). SPECIAL-USE {@code \Trash} 가 있으면 그
   * 폴더, 없으면 이름으로 — 최상위·INBOX 바로 아래·Gmail 묶음({@code [Gmail]}) 바로 아래의 Trash·Deleted Items·휴지통 등. 이름
   * 후보가 여럿이면 {@link #TRASH_NAMES} 순서(그다음 LIST 순서)로 고른다. 메일을 담지 못하는 폴더는 고르지 않는다.
   *
   * @return 휴지통 전체 경로. 찾지 못하면 null
   */
  public static String findTrash(List<Entry> entries) {
    for (Entry e : entries) {
      if (e.holdsMessages()
          && e.attributes().stream().anyMatch(a -> ATTR_TRASH.equalsIgnoreCase(a))) {
        return e.fullName();
      }
    }
    String best = null;
    int bestRank = Integer.MAX_VALUE;
    for (Entry e : entries) {
      if (!e.holdsMessages()) {
        continue;
      }
      List<String> segs = segments(e);
      boolean nameCheckable =
          segs.size() == 1
              || (segs.size() == 2
                  && ("INBOX".equalsIgnoreCase(segs.get(0))
                      || GMAIL_ROOTS.contains(segs.get(0).toLowerCase(Locale.ROOT))));
      if (!nameCheckable) {
        continue;
      }
      int rank = TRASH_NAMES.indexOf(segs.get(segs.size() - 1).trim().toLowerCase(Locale.ROOT));
      if (rank >= 0 && rank < bestRank) {
        best = e.fullName();
        bestRank = rank;
      }
    }
    return best;
  }

  private static boolean isVisibleKind(Kind k) {
    return k == Kind.ARCHIVE || k == Kind.USER;
  }

  /** 구분자로 자른 경로 조각. 평면 이름공간(구분자 없음)이면 전체 이름 한 조각. */
  private static List<String> segments(Entry e) {
    char sep = e.separator();
    if (sep == '\0') {
      return List.of(e.fullName());
    }
    List<String> out = new ArrayList<>();
    int from = 0;
    String name = e.fullName();
    for (int i = 0; i < name.length(); i++) {
      if (name.charAt(i) == sep) {
        out.add(name.substring(from, i));
        from = i + 1;
      }
    }
    out.add(name.substring(from));
    return out;
  }

  /** 부모 전체 경로(마지막 구분자 앞부분). 최상위·평면이면 null. */
  private static String parentPath(Entry e) {
    if (e.separator() == '\0') {
      return null;
    }
    int idx = e.fullName().lastIndexOf(e.separator());
    return idx <= 0 ? null : e.fullName().substring(0, idx);
  }
}
