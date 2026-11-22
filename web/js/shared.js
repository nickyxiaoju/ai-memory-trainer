function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function onCommittedInput(el, commit, composition) {
  let composing = false;
  el.addEventListener('compositionstart', () => { composing = true; if (composition) composition(true); });
  el.addEventListener('compositionend', () => { composing = false; if (composition) composition(false); commit(el.value); });
  el.addEventListener('input', e => { if (!composing && !e.isComposing) commit(el.value); });
}
