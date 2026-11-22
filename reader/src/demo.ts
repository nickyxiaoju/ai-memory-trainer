import type { ReadingDoc } from './types';

const processDefinition = '进程是资源分配的基本单位。';
const threadDefinition = '同一进程内的线程共享地址空间，但各自拥有独立的栈。';
const snapshotDefinition = '快照保留的是复制时的正文。';

// Section i corresponds to PDF page i + 1. Quote rects come from pdftotext -bbox.
export const demo: ReadingDoc = {
  id: 'os-processes',
  title: '操作系统基础讲义',
  chapter: '进程与线程',
  format: 'PDF',
  pdfUrl: '/processes.pdf',
  sections: [
    {
      title: '进程：资源的边界',
      paragraphs: [
        processDefinition,
        '每个进程有自己的虚拟地址空间和打开的文件表。同一进程里的线程共用这份地址映射，因此能直接读写同一份数据。',
        '换一个进程，相同的虚拟地址通常指向另一块内存。要跨过这道边界，可以通过管道传递消息，也可以显式建立共享内存。',
        '同为 0x1000，进程甲读到 7，进程乙读到 9。',
      ],
      annotation: {
        label: '资源边界',
        quote: processDefinition,
        explanation: '图 1 中，同一边框里的两条线通向同一个单元。换到另一个边框，地址就要按另一个进程的映射来解释。',
        rects: [[0.066668, 0.242589, 0.346673, 0.04]],
      },
      checkpoint: {
        kind: 'answer',
        prompt: '为什么同一进程内的线程可以直接访问同一份数据，而不同进程通常不能？',
        hint: '对照图 1：相同的地址写在两个边框里，读到的值一样吗？',
      },
    },
    {
      title: '线程：执行的路径',
      paragraphs: [
        threadDefinition,
        '调度器可以暂停一个线程，先让另一个运行。系统保存被暂停线程的程序计数器等寄存器的值，以便它恢复时能从原处继续。',
        '两个线程即使调用同一个排版函数，也会在各自的栈上建立栈帧。其中一个调用返回时，另一个线程的栈帧仍然保留。',
        '排版调用结束后，线程甲回到预览，线程乙回到打印。',
      ],
      annotation: {
        label: '独立的栈',
        quote: threadDefinition,
        explanation: '图 2 的两个栈顶都是“排版”，下方却分别是“预览”和“打印”。返回路径取决于这个线程自己的调用记录。',
        rects: [[0.066668, 0.242589, 0.666679, 0.04]],
      },
      checkpoint: {
        kind: 'retype',
        prompt: '请逐字复现本页说明地址空间与栈的那句话，保留原文标点。',
        target: threadDefinition,
        hint: '回想逗号前后各讲了什么，再检查句末标点。',
      },
    },
    {
      title: '从模型到实践',
      paragraphs: [
        snapshotDefinition,
        '编辑器的输入线程和保存线程共用正文缓冲区。正文里只有“山”时，保存线程拿到锁，复制正文得到一份独立快照，然后释放锁。',
        '输入线程随后拿到同一把锁，添上一个“水”字并释放锁。保存线程此时才把快照写入磁盘：文件里是“山”，屏幕上已是“山水”。',
        '从追加文字的那一列起，正文与快照不再相同。',
      ],
      annotation: {
        label: '快照的时刻',
        quote: snapshotDefinition,
        explanation: '图 3 要按列读：追加文字只改变了正文。最后写入文件的是先前的副本，不是此时屏幕上的文字。',
        rects: [[0.066668, 0.242589, 0.346673, 0.04]],
      },
    },
  ],
};
