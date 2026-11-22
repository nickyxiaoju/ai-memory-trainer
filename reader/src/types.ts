export type Rect = [x: number, y: number, width: number, height: number];

export interface Annotation {
  label: string;
  quote: string;
  explanation: string;
  rects?: Rect[]; // Relative to the rotated, scale-1 PDF viewport, from its top left.
}

export interface Blank {
  answer: string;   // The printed word(s); slice this from quote, never redraw the page.
  quote: string;    // Exact source line containing the answer.
  offset: number;   // Code-point offset of answer within quote.
  paragraph?: number;
  rects?: Rect[];   // Only when the phrase box was checked against the rendered page.
}

export type Checkpoint =
  | { kind: 'blank'; prompt: string; hint: string; blanks: Blank[] }
  | { kind: 'answer'; prompt: string; hint: string; blanks?: Blank[] }
  | { kind: 'retype'; prompt: string; target: string; hint: string };

export interface Section {
  title: string;
  paragraphs: string[];
  annotation?: Annotation;
  checkpoint?: Checkpoint;
}

export interface ReadingDoc {
  id: string;
  title: string;
  chapter: string;
  format: 'PDF' | 'TXT' | 'DOCX' | 'PPTX';
  sections: Section[];
  pdfUrl?: string;
  file?: Blob;
}

export interface Progress {
  page: number;
  passed: number[];
  mistakes: number[];
  finished: boolean;
  updated: number;
  position?: { page: number; mode: 'pdf'|'text'; offset: number };
  via?: Record<string, 'answer' | 'blank' | 'retype'>;
}
