import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, restore, canRead, completeGate, searchReadable, frontier } from '../src/progress.ts';
import { checkAnswer, retypeChars, matchesBlank, blanksDone } from '../src/validation.ts';
import { sliceCodePoints } from '../src/text.ts';
import { demo } from '../src/demo.ts';

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
  const p = completeGate(testDoc,emptyProgress(),0,'blank');
  assert.equal(p.page,0); assert.equal(frontier(testDoc,p),1); assert.equal(canRead(testDoc,p,0),true);
  assert.equal(p.via['0'],'blank');
  assert.equal(searchReadable(testDoc,p,'独立的栈')[0].page,1); assert.equal(completeGate(testDoc,p,0),p);
  assert.equal(restore(testDoc,{...p,page:8}).page,1);
  assert.equal(restore(testDoc,{...p,via:{0:'blank'}}).via['0'],'blank');
  assert.equal(restore(testDoc,{...p,via:{0:'guessed',1:'answer'}}).via,undefined);
  const both=completeGate(testDoc,p,1,'answer'); assert.equal(frontier(testDoc,both),2);
  assert.deepEqual(both.via,{0:'blank',1:'answer'});
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
  assert.equal(checkAnswer('线程是程序。').contradicted,false);
  assert.equal(checkAnswer('线程是程序。').message.includes('直接改用原文填空'),true);
  assert.equal(checkAnswer('进程共享内存，线程各自隔离。').contradicted,true);
});
test('严格复现只统一全半角与 Unicode 组合，不忽略空格、缺失的标点或大小写', () => {
  assert.deepEqual(retypeChars('Ａ，Ｂ　Ｃ'),retypeChars('A,B C'));
  assert.notDeepEqual(retypeChars('地址空间。'),retypeChars('地址空间'));
  assert.notDeepEqual(retypeChars('地址 空间'),retypeChars('地址空间'));
  assert.notDeepEqual(retypeChars('CPU'),retypeChars('cpu'));
  assert.deepEqual(retypeChars('e\u0301'),retypeChars('é'));
});
test('原位填空只核对被挖的词，允许外侧空白和全角英数，不吞掉内部空格或标点', () => {
  const space = { answer:'ABC', quote:'x ABC y', offset:2 };
  assert.equal(matchesBlank(' ＡＢＣ ', space), true);
  assert.equal(matchesBlank('AB C', space), false);
  assert.equal(matchesBlank('ABC。', space), false);
  const blanks = [{ answer:'地址空间', quote:'x 地址空间 y', offset:2 }, { answer:'独立的栈', quote:'x 独立的栈 y', offset:2 }];
  assert.deepEqual(blanksDone(['地址空间','独立的栈'], blanks), [true,true]);
  assert.deepEqual(blanksDone(['地址空间','独立'], blanks), [true,false]);
});
test('示例的原位空只切出原文中已核对的词', () => {
  for (const section of demo.sections) {
    const task = section.checkpoint;
    if (!task || !('blanks' in task) || !task.blanks) continue;
    for (const blank of task.blanks) {
      assert.equal(sliceCodePoints(blank.quote, blank.offset, blank.offset + Array.from(blank.answer).length), blank.answer);
      assert.ok(section.paragraphs.some((text, i) => text.includes(blank.quote) && (blank.paragraph === undefined || blank.paragraph === i)));
      for (const [x,y,w,h] of blank.rects || []) assert.ok(0 <= x && x + w <= 1 && 0 <= y && y + h <= 1);
    }
  }
});
