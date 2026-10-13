// 빈 AI 대화 추천 결과 저장소(WP-139) — 같은 대상의 이전 AI 결과를 즉시 보여 주고(stale-while-revalidate), 서울 날짜가 같으면 다시 부르지 않는다.
// 앞단 메모리 Map(같은 탭의 결과·진행 중 요청·실패 공유) + 뒷단 localStorage(키 `ai-starter:v1:<userId>:<tenantId>`, 최근 저장 50개).
// localStorage 접근은 전부 try/catch — 사생활 보호 모드·용량 초과·깨진 JSON 이어도 메모리만으로 동작한다. 실패는 메모리에만 기록한다.

/** localStorage 키 접두 — 로그아웃 때 이 접두의 키를 모두 지운다. */
export const STARTER_STORAGE_PREFIX = 'ai-starter:v1:';
/** 사용자·워크스페이스당 보관 개수 — 대상(화면) 수가 무한히 늘어 저장소를 채우지 않게. */
const MAX_ENTRIES = 50;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & { readonly length: number };

interface StoredEntry {
  items: string[];
  /** 저장한 서울 날짜(yyyy-MM-dd) — 오늘이면 다시 부르지 않는다. */
  date: string;
  /** 저장 시각(ms) — 50개를 넘으면 오래된 것부터 지운다. */
  at: number;
}

const SEOUL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
/** 서울 날짜 yyyy-MM-dd — 표시용이 아니라 만료 판정 키라 formatters 를 쓰지 않는다. */
export const seoulDate = (d: Date): string => SEOUL_DATE.format(d);

const isEntry = (v: unknown): v is StoredEntry => {
  const e = v as StoredEntry | null;
  return !!e && Array.isArray(e.items) && e.items.every((x) => typeof x === 'string') && typeof e.date === 'string' && typeof e.at === 'number';
};

/** 저장소 생성 — 테스트는 storage·now 를 주입한다. 기본은 window.localStorage(접근이 막히면 null). */
export function createStarterStore(opts: { storage?: () => KeyValueStore | null; now?: () => Date } = {}) {
  const readStorage =
    opts.storage ??
    (() => {
      try {
        return typeof window === 'undefined' ? null : window.localStorage;
      } catch {
        return null;
      }
    });
  const now = opts.now ?? (() => new Date());
  const memory = new Map<string, StoredEntry>();
  const failures = new Map<string, string>(); // 키 → 실패한 서울 날짜
  const inflight = new Map<string, Promise<string[]>>();
  const mk = (owner: string, key: string) => `${owner}|${key}`;

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
    let e = memory.get(mk(owner, key));
    if (!e) {
      const stored = readAll(owner)[key];
      if (stored) {
        e = stored;
        memory.set(mk(owner, key), stored);
      }
    }
    return e ? { items: e.items, fresh: e.date === seoulDate(now()) } : null;
  }

  /** AI 결과 저장 — 메모리 + localStorage(최근 50개). 같은 키의 실패 기록은 지운다. */
  function save(owner: string, key: string, items: string[]) {
    const entry: StoredEntry = { items, date: seoulDate(now()), at: now().getTime() };
    memory.set(mk(owner, key), entry);
    failures.delete(mk(owner, key));
    const map = readAll(owner);
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

  /** 실패(네트워크·5xx·빈 결과·꺼짐) — 그날은 다시 부르지 않는다. 메모리에만. */
  function markFailed(owner: string, key: string) {
    failures.set(mk(owner, key), seoulDate(now()));
  }
  const failedToday = (owner: string, key: string) => failures.get(mk(owner, key)) === seoulDate(now());

  /** 같은 키의 진행 중 요청을 공유하고, 끝나면 저장 또는 실패 기록. 결코 reject 하지 않는다(실패는 빈 목록). */
  function run(owner: string, key: string, fetcher: () => Promise<string[]>): Promise<string[]> {
    const k = mk(owner, key);
    const cur = inflight.get(k);
    if (cur) return cur;
    const p = fetcher()
      .then(
        (items) => {
          if (items.length) save(owner, key, items);
          else markFailed(owner, key);
          return items;
        },
        () => {
          markFailed(owner, key);
          return [] as string[];
        },
      )
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  }

  /** 로그아웃 — 메모리와 이 접두의 localStorage 키를 모두 지운다(다른 계정에 이전 결과가 보이지 않게). */
  function clearAll() {
    memory.clear();
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

  return { peek, save, markFailed, failedToday, resetFailures: () => failures.clear(), run, clearAll };
}

export type StarterStore = ReturnType<typeof createStarterStore>;

/** 앱 전역 기본 인스턴스. */
export const starterStore = createStarterStore();

/** 로그아웃 때 추천 저장을 비운다. */
export const clearStarterStorage = (): void => starterStore.clearAll();
