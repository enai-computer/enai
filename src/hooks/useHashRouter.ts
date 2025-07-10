"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface HashRouterParams {
  notebookId?: string;
}

interface HashRouter {
  push: (path: string) => void;
  params: HashRouterParams;
  pathname: string;
}

export function useHashRouter(): HashRouter {
  const [currentPath, setCurrentPath] = useState<string>('');

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) || '/';
      setCurrentPath(hash);
    };

    // Set initial path
    handleHashChange();

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const push = useCallback((path: string) => {
    window.location.hash = path;
  }, []);

  const params = useMemo((): HashRouterParams => {
    const match = currentPath.match(/\/notebook\/([^\/]+)/);
    return {
      notebookId: match?.[1] || undefined
    };
  }, [currentPath]);

  return {
    push,
    params,
    pathname: currentPath
  };
}