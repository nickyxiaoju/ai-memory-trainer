import type { Progress, ReadingDoc, Section } from './types';
import { restore } from './progress.ts';

const prefix = 'folio.v1.';
export function loadProgress(doc: ReadingDoc) {
  let raw: Partial<Progress> | undefined;
  try { raw = JSON.parse(localStorage.getItem(prefix + doc.id) || 'null'); } catch { /* A private window can still read for this session. */ }
  return restore(doc, raw);
}
export function persist(doc: ReadingDoc, progress: Progress) { localStorage.setItem(prefix + doc.id, JSON.stringify(progress)); }
export function lastDoc() { try { return localStorage.getItem(prefix + 'last'); } catch { return null; } }
export function saveLast(id: string) { localStorage.setItem(prefix + 'last', id); }

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('folio-documents', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('docs', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function listImports(): Promise<ReadingDoc[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('docs'); const r = tx.objectStore('docs').getAll();
    tx.oncomplete = () => { database.close(); resolve(r.result); };
    tx.onabort = () => { database.close(); reject(tx.error); };
  });
}
async function saveImport(doc: ReadingDoc) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction('docs', 'readwrite'); tx.objectStore('docs').put(doc);
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onabort = () => { database.close(); reject(new Error('浏览器存储空间不足或被禁用，资料没有保存。')); };
  });
}
export async function importFile(file: File, stage: (s: string) => void): Promise<ReadingDoc> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !['pdf', 'txt', 'docx', 'pptx'].includes(ext)) throw new Error('支持 PDF、DOCX、PPTX 和 UTF-8 TXT；旧式 PPT/DOC 请先另存为 PDF。');
  if (file.size > 12 * 1024 * 1024 || !file.size) throw new Error(file.size ? '单个文件不能超过 12 MiB。' : '文件为空，请重新选择。');
  stage('正在本机解析原文、定位摘录并生成规则检查点…');
  const res = await fetch('/api/analyse?format=' + ext, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  if (!res.ok) throw new Error(await res.text());
  const { sections } = await res.json() as { sections: Section[] };
  if (!sections?.length) throw new Error('没有找到可供练习的原文。');
  const doc: ReadingDoc = { id: crypto.randomUUID(), title: file.name.replace(/\.[^.]+$/, '') || file.name, chapter: '文档阅读', format: ext.toUpperCase() as ReadingDoc['format'], sections };
  if (doc.format === 'PDF') doc.file = file;
  stage('解析完成，正在保存到此浏览器…'); await saveImport(doc); return doc;
}
