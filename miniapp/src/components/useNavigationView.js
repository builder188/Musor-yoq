import { useEffect, useRef } from 'react';
import { useApp } from '../store/AppContext.jsx';

export function useNavigationView(title, onBack) {
  const { pushNavigation, removeNavigation, goBack } = useApp();
  const backRef = useRef(onBack);

  useEffect(() => {
    backRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    const id = pushNavigation({
      title,
      onBack: () => backRef.current?.(),
    });
    return () => removeNavigation(id);
  }, [pushNavigation, removeNavigation, title]);

  return goBack;
}
