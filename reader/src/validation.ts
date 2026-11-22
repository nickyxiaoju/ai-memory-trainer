export function retypeChars(value: string) {
  return Array.from(value.normalize('NFC').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' '));
}

export function checkAnswer(input: string): { ok: boolean; message: string } {
  const text = input.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const clauses = text.split(/[，。；、,;.!！?？\n]|但是|而且|而|但/).filter(Boolean);
  const resource = /地址空间|内存空间|内存|资源|地址|数据|堆|存储空间/;
  const shared = /共享|共有|共用|公用|同一(?:份|块|片|个|套)|相同的|(?:用的?是|一起用|共同使用)(?:同)?一(?:份|块|片|套)|共同(?:使用|访问)|能(?:够)?直接(?:访问|读写)|可以(?:直接)?(?:访问|读写)/;
  const separate = /隔离|独立|各自|分离|私有|互不|(?:有|使用|拥有)自己的(?:地址|内存|空间)|看不到(?:对方|彼此|其他)|不(?:能|会|可)(?:直接|以)?(?:访问|共享|读写)|(?:地址空间|内存|资源)(?:是)?(?:不同|分开)|不同的(?:地址空间|(?:物理)?内存)|不共享|不共用/;
  const negShare = /不(?:会|是|能|再)?(?:直接)?(?:共享|共用)|并非共享|无法(?:直接)?(?:共享|访问)|没有共享/;
  const threadClause = (s: string) => /线程/.test(s) && !/不同(?:的)?进程(?!内)/.test(s);
  const processClause = (s: string) => /进程/.test(s) && !/线程/.test(s);
  let subject = '', share = false, isolation = false, contradiction = false;
  for (const s of clauses) {
    if (threadClause(s)) subject = 'thread';
    else if (processClause(s)) subject = 'process';
    const hasResource = resource.test(s) || /共享|共用|隔离|独立|互不/.test(s);
    if (subject === 'thread' && hasResource && shared.test(s) && !negShare.test(s)) share = true;
    if (subject === 'process' && hasResource && separate.test(s) && !/不(?:是|相互)?(?:独立|隔离)|没有隔离/.test(s)) isolation = true;
    if ((subject === 'thread' && negShare.test(s)) || (subject === 'process' && shared.test(s) && !separate.test(s))) contradiction = true;
  }
  if (!contradiction && share && isolation) return { ok: true, message: '你区分了线程共享的资源与进程之间的隔离。' };
  if (contradiction) return { ok: false, message: '再核对两者的方向：谁在同一个地址空间里，谁通常有独立的空间？' };
  return { ok: false, message: share ? '已经说清线程的共享关系。再补一句：不同进程的地址空间是什么关系？' : isolation ? '已经提到进程的隔离。再说明同一进程里的线程使用哪一份内存。' : '试着分别描述两层关系：同一进程里的线程怎样使用内存？不同进程之间呢？' };
}
