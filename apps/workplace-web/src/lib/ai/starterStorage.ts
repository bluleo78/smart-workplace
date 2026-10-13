// 빈 AI 대화 추천 결과 저장소(WP-139) — 같은 대상의 이전 AI 결과를 즉시 보여 주고(stale-while-revalidate), 서울 날짜가 같으면 다시 부르지 않는다.
// 앞단 메모리(소유자별로 localStorage 를 한 번만 읽어 올린 결과·진행 중 요청·실패 공유) + 뒷단 localStorage(키 `ai-starter:v1:<userId>:<tenantId>`,
// 최근 저장 50개). 한 번 올린 뒤 없는 키도 메모리로 판정한다 — 다른 탭이 그 뒤에 쓴 결과는 새로고침 전까지 보지 않는다(캐시라 충분하다).
// localStorage 접근은 전부 try/catch — 사생활 보호 모드·용량 초과·깨진 JSON 이어도 메모리만으로 동작한다. 실패는 메모리에만, 10분 동안만 기록한다.
import { kstDateKey } from '@/lib/formatters';
import { safeLocalStorage } from '@/lib/safeLocalStorage';


/** localStorage 키 접두 — 로그아웃 때 이 접두의 키를 모두 지운다. */
export const STARTER_STORAGE_PREFIX = 'ai-starter:v1:';
/** 사용자·워크스페이스당 보관 개수 — 대상(화면) 수가 무한히 늘어 저장소를 채우지 않게. */
const MAX_ENTRIES = 50;
/**
 * 실패(빈 결과·오류)를 기억하는 시간 — 그사이엔 다시 부르지 않는다. 하루 내내 막으면 비서를 막 연결했거나 일시 장애였을 때 그날 고정 문구만 남는다.
 * 타이머로 다시 부르지는 않는다 — 10분 뒤 패널을 다시 열거나 대상이 바뀔 때(훅 효과가 다시 돌 때) 부른다.
 */
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & { readonly length: number };

interface StoredEntry {
  items: string[];
  /** 저장한 서울 날짜(yyyy-MM-dd) — 오늘이면 다시 부르지 않는다. */
  date: string;
  /** 저장 시각(ms) — 50개를 넘으면 오래된 것부터 지운다. */
  at: number;
}

const isEntry = (v: unknown): v is StoredEntry => {
  const e = v as StoredEntry | null;
  return !!e && Array.isArray(e.items) && e.items.every((x) => typeof x === 'string') && typeof e.date === 'string' && typeof e.at === 'number';
};

/** 저장소 생성 — 테스트는 storage·now 를 주입한다. 기본은 window.localStorage(접근이 막히면 null). */
export function createStarterStore(opts: { storage?: () => KeyValueStore | null; now?: () => Date } = {}) {
  const readStorage = opts.storage ?? safeLocalStorage;
  const now = opts.now ?? (() => new Date());
  /** 소유자 → 저장 결과(대상 키 → 항목). localStorage 는 소유자마다 처음 한 번만 파싱해 올린다. */
  const owners = new Map<string, Record<string, StoredEntry>>();
  const failures = new Map<string, number>(); // 키 → 실패 시각(ms)
  const inflight = new Map<string, Promise<string[]>>();
  /** clearAll(로그아웃) 마다 올린다 — 로그아웃 전에 시작한 요청이 뒤늦게 끝나 지운 저장소를 다시 채우지 않게 한다. */
  let epoch = 0;
  const mk = (owner: string, key: string) => `${owner}|${key}`;

  /** 소유자의 저장 결과 — 메모리에 없을 때만 localStorage 를 읽어 올린다. */
  function entriesOf(owner: string): Record<string, StoredEntry> {
    let map = owners.get(owner);
    if (!map) {
      map = readAll(owner);
      owners.set(owner, map);
    }
    return map;
  }
  function readAll(owner: string): Record<string, StoredEntry> {
    try {
      const raw = readStorage()?.getItem(STARTER_STORAGE_PREFIX + owner);
      const v: unknown = raw ? JSON.parse(raw) : {};
      if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, e]) => isEntry(e))) as Record<string, StoredEntry>;
    } catch {
      return {}; // 읽기 실패·깨진 JSON — 빈 상태로 본다
    }
  }
  function writeAll(owner: string, map: Record<string, StoredEntry>) {
    try {
      readStorage()?.setItem(STARTER_STORAGE_PREFIX + owner, JSON.stringify(map));
    } catch {
      // 저장 실패(사생활 보호 모드·용량 초과)해도 메모리 결과는 유지한다.
    }
  }

  /** 저장된 결과 — fresh 는 저장 날짜가 오늘(서울)인지. 없으면 null. */
  function peek(owner: string, key: string): { items: string[]; fresh: boolean } | null {
    const e = entriesOf(owner)[key];
    return e ? { items: e.items, fresh: e.date === kstDateKey(now()) } : null;
  }

  /** AI 결과 저장 — 메모리 + localStorage(최근 50개). 같은 키의 실패 기록은 지운다. */
  function save(owner: string, key: string, items: string[]) {
    const entry: StoredEntry = { items, date: kstDateKey(now()), at: now().getTime() };
    failures.delete(mk(owner, key));
    // 저장은 드물어(생성 1회당 1번) 여기서만 localStorage 를 다시 읽는다 — 다른 탭이 그 사이 저장한 항목을 덮어쓰지 않게 병합한다.
    const map = { ...entriesOf(owner), ...readAll(owner) };
    owners.set(owner, map);
    map[key] = entry;
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => map[a].at - map[b].at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete map[k]);
    }
    writeAll(owner, map);
  }

  /** 실패(네트워크·5xx·빈 결과·꺼짐) — {@link FAILURE_COOLDOWN_MS} 동안 다시 부르지 않는다. 메모리에만. */
  function markFailed(owner: string, key: string) {
    failures.set(mk(owner, key), now().getTime());
  }
  /** 최근(10분 안)에 실패했는가 — 그렇다면 부르지 않는다. */
  const recentlyFailed = (owner: string, key: string) => {
    const at = failures.get(mk(owner, key));
    return at !== undefined && now().getTime() - at < FAILURE_COOLDOWN_MS;
  };

  /** 같은 키의 진행 중 요청을 공유하고, 끝나면 저장 또는 실패 기록. 결코 reject 하지 않는다(실패는 빈 목록). */
  function run(owner: string, key: string, fetcher: () => Promise<string[]>): Promise<string[]> {
    const k = mk(owner, key);
    const cur = inflight.get(k);
    if (cur) return cur;
    const startedAt = epoch;
    const p = fetcher()
      .then(
        (items) => {
          // 시작 이후 clearAll 이 있었으면(로그아웃) 저장·실패 기록을 건너뛴다 — 결과는 호출자에게만 돌려준다.
          if (epoch === startedAt) {
            if (items.length) save(owner, key, items);
            else markFailed(owner, key);
          }
          return items;
        },
        () => {
          if (epoch === startedAt) markFailed(owner, key);
          return [] as string[];
        },
      )
      // clearAll 뒤 같은 키로 새로 시작한 요청의 진행 중 표시를 옛 요청이 지우지 않게 자기 것일 때만 지운다.
      .finally(() => {
        if (inflight.get(k) === p) inflight.delete(k);
      });
    inflight.set(k, p);
    return p;
  }

  /** 로그아웃 — 메모리와 이 접두의 localStorage 키를 모두 지운다(다른 계정에 이전 결과가 보이지 않게). */
  function clearAll() {
    epoch++;
    owners.clear();
    failures.clear();
    inflight.clear();
    try {
      const s = readStorage();
      if (!s) return;
      const keys: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k?.startsWith(STARTER_STORAGE_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => s.removeItem(k));
    } catch {
      // 지우지 못해도 로그아웃은 계속된다 — 다음 사용자는 owner 키가 달라 섞이지 않는다.
    }
  }

  return { peek, save, markFailed, recentlyFailed, resetFailures: () => failures.clear(), run, clearAll };
}

/** 앱 전역 기본 인스턴스. */
export const starterStore = createStarterStore();

/** 로그아웃 때 추천 저장을 비운다. */
export const clearStarterStorage = (): void => starterStore.clearAll();
