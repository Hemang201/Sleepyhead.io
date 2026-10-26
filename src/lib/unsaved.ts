import { useEffect, useState } from 'react';

/**
 * Warns before losing unsaved edits.
 *
 * Two layers, because neither is enough on its own: a `beforeunload` handler for
 * a reload or a closed tab, and an in-page flag the editor renders as a banner
 * with a "discard" action, since client-side navigation never fires
 * `beforeunload`.
 */
export function useUnsavedChanges(dirty: boolean, message = 'You have unpublished edits. Leaving now discards them.') {
  const [warned, setWarned] = useState(false);

  useEffect(() => {
    if (!dirty) {
      setWarned(false);
      return undefined;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome ignores custom text now, but the prompt still appears.
      event.returnValue = message;
      setWarned(true);
      return message;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, message]);

  return warned;
}
