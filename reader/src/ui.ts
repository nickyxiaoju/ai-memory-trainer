const paths = {
  book: 'M3 5h5c2 0 3 .6 4 2 1-1.4 2-2 4-2h5v14h-5c-2 0-3 .6-4 2-1-1.4-2-2-4-2H3z M12 7v14',
  library: 'M4 4v16 M8 4v16 M12 5v15 M16 5l4 14', toc: 'M4 5h16v14H4z M10 5v14 M6 9h2 M6 12h2',
  panel: 'M3 5h18v14H3z M15 5v14 M17 9h2 M17 12h2',
  layers: 'm3 8 9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5',
  find: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  next: 'm9 5 7 7-7 7', back: 'm15 5-7 7 7 7', down: 'm6 9 6 6 6-6', arrow: 'M4 12h15 M14 6l6 6-6 6',
  quote: 'M5 8h5v5H6c0 2-1 3-2 4 M15 8h5v5h-4c0 2-1 3-2 4',
  highlight: 'm5 14 8-9 5 5-8 9z M4 15l-1 5 5-1 M14 4l2-2 5 5-2 2',
  note: 'M4 4h12l4 4v12H4z M15 4v5h5 M7 13h9 M7 16h6',
  lock: 'M5 10h14v10H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v2', check: 'm4 12 5 5L20 6',
  location: 'M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z M14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  edit: 'M3 21l5-1L20 8l-5-5L3 15z M12 6l5 5', bulb: 'M9 18h6 M10 21h4 M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2',
  keyboard: 'M2 6h20v12H2z M5 10h1 M9 10h1 M13 10h1 M17 10h1 M7 14h10', enter: 'M19 5v9H5 M9 10l-4 4 4 4',
  upload: 'M12 16V3 M7 8l5-5 5 5 M4 16v4h16v-4', close: 'm5 5 14 14 M19 5 5 19',
  minus: 'M5 12h14', plus: 'M5 12h14 M12 5v14', screen: 'M3 9V4h5 M16 4h5v5 M21 15v5h-5 M8 20H3v-5',
  text: 'M3 6h18 M3 11h14 M3 16h16', file: 'M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h6',
  shield: 'M12 2l8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5z M8 12l3 3 5-6',
  time: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2', flag: 'M5 22V3 M5 4h14l-3 4 3 4H5',
  redo: 'M4 4v6h6 M4 10a8 8 0 1 1 0 5', link: 'm9 15 6-6 M8 16l-1 1a3.5 3.5 0 1 1-5-5l4-4a3.5 3.5 0 0 1 5 0 M16 8l1-1a3.5 3.5 0 1 1 5 5l-4 4a3.5 3.5 0 0 1-5 0',
  menu: 'M4 6h16 M4 12h16 M4 18h16', local: 'M3 4h18v13H3z M8 21h8 M12 17v4', sun: 'M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2', moon:'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11',
};
export type Icon = keyof typeof paths;
export function icon(name: Icon, size = 17) { return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`; }
export function button(action: string, name: Icon, label: string, extra = '') { return `<button type="button" class="icon-button" data-act="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(name)}</button>`; }
export const two = (n: number) => String(n).padStart(2, '0');
export function brand() { return '<span class="brand"><img src="/folio.svg" width="29" height="29" alt=""><strong>页间</strong><em>Folio</em></span>'; }
let toastTimer: ReturnType<typeof setTimeout>;
export function notify(message: string) { const el = document.getElementById('notice')!; el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3800); }
export function ProgressIndicator(done: number, total: number) { return `<div class="meter" role="progressbar" aria-label="已通过检查点" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${done}"><i style="width:${total ? done / total * 100 : 0}%"></i></div>`; }
