import { useEffect, useRef, useState, useCallback } from "react"

// How many pixels from the bottom of the container to enable auto-scroll
const ACTIVATION_THRESHOLD = 50
// Minimum pixels of scroll-up movement required to disable auto-scroll
const MIN_SCROLL_UP_THRESHOLD = 10
// Debounce delay for auto-scroll during rapid updates (e.g., streaming)
const AUTO_SCROLL_DEBOUNCE_MS = 50

export function useAutoScroll(dependencies: React.DependencyList) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const previousScrollTop = useRef<number | null>(null)
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const scrollToBottom = () => {
    // Cancel any pending debounced scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
      scrollTimeoutRef.current = null
    }
    
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }

  const debouncedScrollToBottom = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      scrollToBottom()
    }, AUTO_SCROLL_DEBOUNCE_MS)
  }, [])

  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current

      const distanceFromBottom = Math.abs(
        scrollHeight - scrollTop - clientHeight
      )

      const isScrollingUp = previousScrollTop.current
        ? scrollTop < previousScrollTop.current
        : false

      const scrollUpDistance = previousScrollTop.current
        ? previousScrollTop.current - scrollTop
        : 0

      const isDeliberateScrollUp =
        isScrollingUp && scrollUpDistance > MIN_SCROLL_UP_THRESHOLD

      if (isDeliberateScrollUp) {
        setShouldAutoScroll(false)
      } else {
        const isScrolledToBottom = distanceFromBottom < ACTIVATION_THRESHOLD
        setShouldAutoScroll(isScrolledToBottom)
      }

      previousScrollTop.current = scrollTop
    }
  }

  const handleTouchStart = () => {
    setShouldAutoScroll(false)
  }

  useEffect(() => {
    if (containerRef.current) {
      previousScrollTop.current = containerRef.current.scrollTop
    }
  }, [])

  useEffect(() => {
    if (shouldAutoScroll) {
      debouncedScrollToBottom()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  return {
    containerRef,
    scrollToBottom,
    handleScroll,
    shouldAutoScroll,
    handleTouchStart,
  }
}
