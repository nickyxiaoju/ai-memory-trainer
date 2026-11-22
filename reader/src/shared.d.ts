declare function escapeHtml(value: unknown): string;
declare function onCommittedInput(el: HTMLTextAreaElement | HTMLInputElement, commit: (value: string) => void, composition?: (active: boolean) => void): void;
