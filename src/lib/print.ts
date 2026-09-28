/* ------------------------------------------------------------------ */
/* window.print() with a document title: browsers use the title as the */
/* default file name for "Als PDF speichern" (R-2026-00002.pdf).       */
/* ------------------------------------------------------------------ */

export function printDocument(title: string) {
  const previous = document.title;
  document.title = title;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
  // print() blocks in most browsers; afterprint covers the others.
  setTimeout(restore, 2000);
}
