"use client";

import { useHashRouter } from '@/hooks/useHashRouter'
import HomeView from '@/components/HomeView'
import NotebookView from '@/components/NotebookView'

export default function HomePage() {
  const { pathname, params } = useHashRouter()

  // Route to appropriate view based on hash
  if (pathname.startsWith('/notebook/') && params.notebookId) {
    return <NotebookView notebookId={params.notebookId} />
  }

  return <HomeView />
}