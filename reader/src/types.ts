export type Rect = [x: number, y: number, width: number, height: number];

export interface Annotation {
  label: string;
  quote: string;
  explanation: string;
  rects?: Rect[]; // Relative to the rotated, scale-1 PDF viewport, from its top left.
}

export type Checkpoint =
  | { kind: 'answer'; prompt: string; hint: string }
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
}
