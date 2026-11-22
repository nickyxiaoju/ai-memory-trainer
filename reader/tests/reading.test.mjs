import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, restore, canRead, completeGate, searchReadable, frontier } from '../src/progress.ts';
import { checkAnswer, retypeChars } from '../src/validation.ts';

const testDoc = { sections: [
  { title:'进程', paragraphs:['共享内存'], checkpoint:{kind:'answer'} },
  { title:'线程', paragraphs:['独立的栈'], checkpoint:{kind:'retype'} },
  { title:'案例', paragraphs:['下一段文字'] },
] };

test('未解锁原文不出现在搜索、跳转、完成或损坏的恢复位置中', () => {
  const p = emptyProgress();
  assert.equal(frontier(testDoc,p),0); assert.equal(canRead(testDoc,p,2),false);
  assert.equal(canRead(testDoc,p,-1),false); assert.equal(canRead(testDoc,p,0.5),false);
  assert.deepEqual(searchReadable(testDoc,p,'独立的栈'),[]);
  assert.equal(completeGate(testDoc,p,1),p);
  assert.deepEqual(restore(testDoc,{page:7,passed:[1],finished:true}),p);
});
test('解锁只前进一步且不自动翻页；重练不重复计数', () => {
  const p = completeGate(testDoc,emptyProgress(),0);
  assert.equal(p.page,0); assert.equal(frontier(testDoc,p),1); assert.equal(canRead(testDoc,p,0),true);
  assert.equal(searchReadable(testDoc,p,'独立的栈')[0].page,1); assert.equal(completeGate(testDoc,p,0),p);
  assert.equal(restore(testDoc,{...p,page:8}).page,1);
  const both=completeGate(testDoc,p,1); assert.equal(frontier(testDoc,both),2);
  assert.equal(restore(testDoc,{...both,finished:true,page:2}).finished,true);
});
test('图像页无可测文本时不构成人为死锁', () => {
  const doc={sections:[{title:'图',paragraphs:[]},...testDoc.sections]};
  assert.equal(frontier(doc,emptyProgress()),1); assert.equal(canRead(doc,emptyProgress(),2),false);
});
test('理解题认可改述与颠倒的叙述次序', () => {
  for (const v of ['线程共用同一块内存，而不同进程的地址空间相互隔离。','进程有各自的地址空间；同一进程内的多个线程共享内存。','同一进程中的线程可以直接访问相同的数据。不同进程有独立的内存空间。','同进程的多个线程用的是一块内存；不同进程看不到彼此的数据。','同进程里的线程共用一份地址映射，不同进程的地址通常对应不同的物理内存。','线程共享内存而且每个进程有自己的地址空间。']) assert.equal(checkAnswer(v).ok,true,v);
});
test('颠倒共享与隔离、否定共享、只列词或只解释一侧不能通过', () => {
  for (const v of ['进程共享内存，线程各自隔离。','线程不共享内存，不同进程有独立地址空间。','共享，进程，线程，内存。','同一个进程中的线程共享地址空间。','线程共享内存，进程不是独立的。']) assert.equal(checkAnswer(v).ok,false,v);
});
test('严格复现只统一全半角与 Unicode 组合，不忽略空格、缺失的标点或大小写', () => {
  assert.deepEqual(retypeChars('Ａ，Ｂ　Ｃ'),retypeChars('A,B C'));
  assert.notDeepEqual(retypeChars('地址空间。'),retypeChars('地址空间'));
  assert.notDeepEqual(retypeChars('地址 空间'),retypeChars('地址空间'));
  assert.notDeepEqual(retypeChars('CPU'),retypeChars('cpu'));
  assert.deepEqual(retypeChars('e\u0301'),retypeChars('é'));
});
