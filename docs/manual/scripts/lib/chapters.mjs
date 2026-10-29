// 매뉴얼 장 파일 읽기. 렌더러와 검사 도구가 같은 목록을 쓰되, 검사가 렌더러(marked 등)를 불러오지 않게 따로 둔다.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './books.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

/**
 * 책 디렉터리의 `NN-*.md` 를 번호순으로 읽어 { file, number, meta, body, raw } 목록으로 돌려준다.
 * 파일명 사전순 정렬이 곧 번호순이다(두 자리 접두). raw 는 프론트매터를 포함한 원문 —
 * 검사·산문 검사가 파일 기준 줄 번호와 여러 줄 YAML 판정에 쓴다.
 * 디렉터리가 없으면(아직 장을 쓰지 않은 책) 빈 배열. 빈 책을 건너뛸지 오류로 볼지는 호출 쪽이 정한다.
 */
export async function loadChapters(book) {
  const dir = path.join(ROOT, book.dir);
  let names;
  try {
    names = await readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e; // 권한 오류 등은 숨기지 않는다
  }
  const chapters = [];
  for (const file of names.filter((f) => /^\d\d-.*\.md$/.test(f)).sort()) {
    const raw = await readFile(path.join(dir, file), 'utf-8');
    const { meta, body } = parseFrontmatter(raw);
    chapters.push({ file, number: Number(file.slice(0, 2)), meta, body, raw });
  }
  return chapters;
}
