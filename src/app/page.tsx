"use client";

import { useHashRouter } from '@/hooks/useHashRouter'
import HomeView from '@/components/HomeView'
import NotebookView from '@/components/NotebookView'
import dynamic from 'next/dynamic'

// Dynamically import OverlayView to avoid loading it on every page
const OverlayView = dynamic(() => import('@/components/OverlayView'), { ssr: false })

export default function HomePage() {
  const { pathname, params } = useHashRouter()

  // Route to appropriate view based on hash
  if (pathname.startsWith('/overlay/')) {
    const windowId = pathname.split('/')[2]
    return <OverlayView windowId={windowId} />
  }
  
  if (pathname.startsWith('/notebook/') && params.notebookId) {
    return <NotebookView notebookId={params.notebookId} />
  }

  return <HomeView />
}