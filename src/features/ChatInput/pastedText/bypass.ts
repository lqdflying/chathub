export const isShiftModifierPasteShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === 'v' && event.shiftKey && (event.ctrlKey || event.metaKey);

export const createShiftPasteBypassTracker = () => {
  let bypassNextPaste = false;

  return {
    consumeBypass: () => {
      const bypass = bypassNextPaste;
      bypassNextPaste = false;
      return bypass;
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (isShiftModifierPasteShortcut(event)) bypassNextPaste = true;
    },
    onKeyUp: (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'v') bypassNextPaste = false;
    },
    reset: () => {
      bypassNextPaste = false;
    },
  };
};
