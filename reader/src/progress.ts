import type { Progress, ReadingDoc } from './types';

export function emptyProgress(): Progress {
  return { page: 0, passed: [], mistakes: [], finished: false, updated: 0 };
}

export function frontier(doc: ReadingDoc, progress: Progress): number {
  const i = doc.sections.findIndex((s, page) => s.checkpoint && !progress.passed.includes(page));
  return i < 0 ? doc.sections.length - 1 : i;
}

export function canRead(doc: ReadingDoc, progress: Progress, page: number) {
  return Number.isInteger(page) && page >= 0 && page <= frontier(doc, progress);
}

export function restore(doc: ReadingDoc, raw?: Partial<Progress>): Progress {
  const p = emptyProgress();
  if (!raw || typeof raw !== 'object') return p;
  for (const [i, s] of doc.sections.entries()) {
    if (!s.checkpoint) continue;
    if (!Array.isArray(raw.passed) || !raw.passed.includes(i)) break;
    p.passed.push(i);
  }
  p.page = Math.max(0, Math.min(Number.isInteger(raw.page) ? raw.page! : 0, frontier(doc, p)));
  p.mistakes = Array.isArray(raw.mistakes) ? [...new Set(raw.mistakes.filter(i => canRead(doc, p, i) && doc.sections[i].checkpoint))] : [];
  p.finished = raw.finished === true && doc.sections.every((s, i) => !s.checkpoint || p.passed.includes(i));
  const at = raw.position;
  if (at && at.page === p.page && (at.mode === 'pdf' || at.mode === 'text') && Number.isFinite(at.offset) && at.offset >= 0) p.position = { page:p.page, mode:at.mode, offset:at.offset };
  p.updated = Number.isFinite(raw.updated) ? raw.updated! : 0;
  return p;
}

export function completeGate(doc: ReadingDoc, p: Progress, page: number): Progress {
  return canRead(doc, p, page) && doc.sections[page].checkpoint && !p.passed.includes(page)
    ? { ...p, passed: [...p.passed, page], updated: Date.now() } : p;
}

export function searchReadable(doc: ReadingDoc, progress: Progress, term: string) {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return [];
  return doc.sections.slice(0, frontier(doc, progress) + 1).flatMap((s, page) => {
    const text = [s.title, ...s.paragraphs].find(t => t.toLocaleLowerCase().includes(needle));
    if (!text) return [];
    const pos = text.toLocaleLowerCase().indexOf(needle);
    return [{ page, text: (pos > 10 ? '…' : '') + text.slice(Math.max(0, pos - 10), pos + needle.length + 23) }];
  });
}
