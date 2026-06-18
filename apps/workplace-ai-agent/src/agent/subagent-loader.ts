// 서브에이전트 정의 로드 + .claude/agents/<name>.md 직렬화·기록.
// claude CLI 는 cwd 의 .claude/agents/*.md 를 자동 발견하므로, 정의를 파일로 두면
// --agents <json> 인라인 전달의 ARG_MAX(E2BIG) 부담이 없다. firehub agent-cli.ts 최소 이식.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// 서브에이전트 한 개의 정의. tools 는 frontmatter 가 강제하는 도구 경계.
export interface SubagentDefinition {
  description: string;
  tools: string[];
  maxTurns?: number;
  model?: string; // 'inherit' 또는 미지정이면 frontmatter 에 쓰지 않음
  prompt: string; // frontmatter 이후 본문(역할/워크플로우/안전 규칙)
}

// 임의 문자열을 YAML double-quoted 스칼라로 안전 직렬화(백슬래시·따옴표·줄바꿈만 이스케이프).
function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

// SubagentDefinition → frontmatter + 본문 markdown.
export function serializeSubagent(name: string, def: SubagentDefinition): string {
  const lines: string[] = ['---', `name: ${name}`, `description: ${yamlDoubleQuoted(def.description)}`];
  if (def.tools.length > 0) {
    lines.push('tools:');
    for (const tool of def.tools) lines.push(`  - ${tool}`);
  }
  if (def.model && def.model !== 'inherit') lines.push(`model: ${def.model}`);
  if (typeof def.maxTurns === 'number') lines.push(`maxTurns: ${def.maxTurns}`);
  lines.push('---', '');
  return lines.join('\n') + def.prompt;
}

// 매 요청마다 workDir/.claude/agents/<name>.md 를 다시 쓴다. 정의가 변해도 일관되도록
// 기존 .md(이전 호출의 stale 포함)를 먼저 모두 정리한 뒤 현재 정의만 기록한다.
export function writeSubagentDefinitions(
  workDir: string,
  defs: Record<string, SubagentDefinition>,
): void {
  const agentsDir = path.join(workDir, '.claude', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  // stale 정리
  for (const f of readdirSync(agentsDir)) {
    if (f.endsWith('.md')) {
      try {
        unlinkSync(path.join(agentsDir, f));
      } catch {
        // 이미 삭제됐거나 권한 문제 — 무시
      }
    }
  }
  for (const [name, def] of Object.entries(defs)) {
    writeFileSync(path.join(agentsDir, `${name}.md`), serializeSubagent(name, def), 'utf8');
  }
}

// 단순 YAML frontmatter 파서 — 문자열/숫자/문자열배열만 지원(firehub 패턴 축약).
interface Frontmatter {
  description?: string;
  tools?: string[];
  maxTurns?: number;
  model?: string;
}
function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const yamlStr = match[1];
  const body = match[2] ?? '';
  const fm: Frontmatter = {};
  const lines = yamlStr.split('\n');
  let i = 0;
  while (i < lines.length) {
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    const val = kv[2];
    if (val === '') {
      // 다음 줄들의 '  - item' 배열 수집(tools 전용)
      const arr: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        arr.push(lines[j].replace(/^\s+-\s+/, '').trim());
        j += 1;
      }
      if (key === 'tools') fm.tools = arr;
      i = j;
      continue;
    }
    const unquoted = val.replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    if (key === 'description') fm.description = unquoted;
    else if (key === 'maxTurns') fm.maxTurns = Number(val);
    else if (key === 'model') fm.model = unquoted;
    i += 1;
  }
  return { frontmatter: fm, body };
}

// subagentsDir 기본값 = 본 모듈 옆 subagents/ (dev=src/agent/subagents, prod=dist/agent/subagents).
// 각 하위 디렉터리의 agent.md 를 읽어 SubagentDefinition 으로. agent.md 없으면 건너뛴다.
export function loadSubagents(subagentsDir: string = path.resolve(here, 'subagents')): Record<string, SubagentDefinition> {
  const out: Record<string, SubagentDefinition> = {};
  let entries: string[];
  try {
    entries = readdirSync(subagentsDir);
  } catch {
    return out; // 디렉터리 부재
  }
  for (const name of entries) {
    const agentMd = path.join(subagentsDir, name, 'agent.md');
    let raw: string;
    try {
      if (!statSync(agentMd).isFile()) continue;
      raw = readFileSync(agentMd, 'utf8');
    } catch {
      continue; // agent.md 없는 디렉터리 건너뜀
    }
    const { frontmatter, body } = parseFrontmatter(raw);
    out[name] = {
      description: frontmatter.description ?? '',
      tools: frontmatter.tools ?? [],
      maxTurns: frontmatter.maxTurns,
      model: frontmatter.model,
      prompt: body,
    };
  }
  return out;
}
