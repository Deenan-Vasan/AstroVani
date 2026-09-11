// Delimiter-balance check that understands JS/TS lexical structure: strings, template
// literals (including ${} interpolation), comments, and REGEX LITERALS with character
// classes. The naive version mis-parsed `let'?s` inside a regex as a string opener and
// `[·|,(]` as a real paren, producing false failures.

import fs from 'node:fs';

const PRE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n']);
const PRE_REGEX_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await']);

function lastMeaningful(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  return j >= 0 ? src[j] : '\n';
}

function precededByKeyword(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  let end = j + 1;
  while (j >= 0 && /[A-Za-z]/.test(src[j])) j--;
  return PRE_REGEX_WORDS.has(src.slice(j + 1, end));
}

export function balance(src) {
  const depth = { '(': 0, '[': 0, '{': 0 };
  let i = 0;
  const templateStack = []; // brace depth at each `${` entry

  while (i < src.length) {
    const c = src[i], n = src[i + 1];

    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }

    if (c === '"' || c === "'") {
      const quote = c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }

    if (c === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') { templateStack.push(depth['{']); depth['{']++; i += 2; break; }
        i++;
      }
      continue;
    }

    // Regex literal: a `/` in a position where a value may begin.
    // JSX confuses this: `<div .../>` puts a `/` after `}` or `"` (both plausible regex
    // positions), and `</div>` puts one after `<`. Neither starts a regex.
    if (c === '/' && n !== '>' && lastMeaningful(src, i) !== '<') {
      const prev = lastMeaningful(src, i);
      if (PRE_REGEX.has(prev) || precededByKeyword(src, i)) {
        i++;
        let inClass = false;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) { i++; break; }
          else if (src[i] === '\n') break; // unterminated: not a regex after all
          i++;
        }
        while (i < src.length && /[gimsuyd]/.test(src[i])) i++;
        continue;
      }
    }

    if (c === '(' || c === '[' || c === '{') depth[c]++;
    else if (c === ')') depth['(']--;
    else if (c === ']') depth['[']--;
    else if (c === '}') {
      depth['{']--;
      if (templateStack.length && depth['{'] === templateStack[templateStack.length - 1]) {
        // Closing a `${}` — resume scanning the enclosing template literal.
        templateStack.pop();
        i++;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '`') { i++; break; }
          if (src[i] === '$' && src[i + 1] === '{') { templateStack.push(depth['{']); depth['{']++; i += 2; break; }
          i++;
        }
        continue;
      }
    }
    i++;
  }
  return depth;
}

const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  const d = balance(fs.readFileSync(f, 'utf8'));
  const ok = d['('] === 0 && d['['] === 0 && d['{'] === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${f} ${JSON.stringify(d)}`);
}
process.exit(bad ? 1 : 0);
