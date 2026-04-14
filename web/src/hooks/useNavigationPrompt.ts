import React from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

type Transition = {
  retry(): void;
};

type NavigatorWithBlock = {
  block(blocker: (transition: Transition) => void): () => void;
};

export function useNavigationPrompt(when: boolean, message: string) {
  const navigationContext = React.useContext(UNSAFE_NavigationContext);

  React.useEffect(() => {
    if (!when) return;

    const navigator = navigationContext.navigator as unknown as NavigatorWithBlock;
    if (typeof navigator.block !== 'function') return;

    const unblock = navigator.block((transition) => {
      const shouldLeave = window.confirm(message);
      if (!shouldLeave) return;

      unblock();
      transition.retry();
    });

    return unblock;
  }, [navigationContext, when, message]);
}