import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

/* Hands some text to whatever this device shares with: the Android share
   sheet in the app, the browser's own share where it has one, otherwise
   the clipboard. Says which happened, so the caller can tell the person. */
export async function shareText({ title, text }) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text, dialogTitle: title });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
