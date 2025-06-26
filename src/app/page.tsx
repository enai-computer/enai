"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BookmarkUploadDialog } from "@/components/BookmarkUploadDialog";
import { PdfUploadDialog } from "@/components/PdfUploadDialog";
import { useRouter } from "next/navigation";
import { IntentLine } from "@/components/ui/intent-line";
import { IntentResultPayload, ContextState, DisplaySlice, SuggestedAction, RecentNotebook, WeatherData } from "../../shared/types";
import { WebLayer } from '@/components/apps/web-layer/WebLayer';
import { MessageList } from "@/components/ui/message-list";
import { motion, AnimatePresence } from "framer-motion";
import { SliceContext } from "@/components/ui/slice-context";
import { RecentNotebooksList } from "@/components/layout/RecentNotebooksList";
import { CornerMasks } from "@/components/ui/corner-masks";

// Define the shape of a message for the chat log (compatible with MessageList)
interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: Date;
}

/**
 * Root page, now primarily displaying the chat interface.
 * Includes a menu for Settings and Upload Data.
 */
export default function WelcomePage() {
  const [intentText, setIntentText] = useState('');
  const [userName, setUserName] = useState<string>('friend');
  const [fullGreeting, setFullGreeting] = useState<string>('');
  const [greetingPart, setGreetingPart] = useState<string>('');
  const [weatherPart, setWeatherPart] = useState<string>('');
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isPdfUploadDialogOpen, setIsPdfUploadDialogOpen] = useState(false);
  const router = useRouter();

  const [webLayerInitialUrl, setWebLayerInitialUrl] = useState<string | null>(null);
  const [isWebLayerVisible, setIsWebLayerVisible] = useState<boolean>(false);

  const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [isNavigatingToNotebook, setIsNavigatingToNotebook] = useState<boolean>(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const intentLineRef = useRef<HTMLInputElement>(null);
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const intentTimingRef = useRef<{startTime: number, correlationId: string} | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedText, setSubmittedText] = useState('');
  const [placeholderText, setPlaceholderText] = useState("What would you like to find, organize, or do?");
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const [hasSubmittedOnce, setHasSubmittedOnce] = useState(false);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [shouldScrollToLatest, setShouldScrollToLatest] = useState(false);
  const [contextSlices, setContextSlices] = useState<ContextState<DisplaySlice[]>>({ status: 'idle', data: null });
  const thinkingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isComposeDialogOpen, setIsComposeDialogOpen] = useState(false);
  const [composeTitle, setComposeTitle] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>([]);
  const [recentNotebooks, setRecentNotebooks] = useState<RecentNotebook[]>([]);
  
  // Refs for alignment
  const greetingRef = useRef<HTMLParagraphElement>(null);
  const [greetingTopOffset, setGreetingTopOffset] = useState<number>(0);


  // Trigger fade-in animation on mount
  useEffect(() => {
    setHasLoaded(true);
    
    // Cleanup function to clear any pending timeouts
    return () => {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch profile
        if (window.api?.getProfile) {
          const profile = await window.api.getProfile();
          if (profile && profile.name) {
            setUserName(profile.name);
          }
        } else {
          console.warn("[WelcomePage] window.api.getProfile is not available.");
        }
        
        // Fetch weather
        if (window.api?.getWeather) {
          const weather = await window.api.getWeather();
          setWeatherData(weather);
        } else {
          console.warn("[WelcomePage] window.api.getWeather is not available.");
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const hour = new Date().getHours();
    let timeOfDay = "day";
    if (hour < 12) {
      timeOfDay = "morning";
    } else if (hour < 18) {
      timeOfDay = "afternoon";
    } else {
      timeOfDay = "evening";
    }
    const dynamicGreeting = `Good ${timeOfDay}, ${userName}`;
    
    // Use real weather data if available, otherwise use default
    let weather = "It's 68° and foggy in San Francisco.";
    if (weatherData) {
      weather = `It's ${weatherData.temperature}° and ${weatherData.description} in San Francisco.`;
    }
    
    setGreetingPart(dynamicGreeting);
    setWeatherPart(weather);
    setFullGreeting("What would you like to find, learn, or do?");
  }, [userName, weatherData]);

  useEffect(() => {
    if (messagesContainerRef.current && !shouldScrollToLatest) {
      const container = messagesContainerRef.current;
      
      // Only auto-scroll for AI responses or when near bottom
      const lastMessage = chatMessages[chatMessages.length - 1];
      const isAIResponse = lastMessage && lastMessage.role === 'assistant';
      
      if (isAIResponse) {
        // For AI responses, always scroll to show them
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom) {
          setTimeout(() => {
            container.scrollTop = container.scrollHeight;
          }, 0);
        }
      }
    }
  }, [chatMessages, shouldScrollToLatest]);

  // Effect for smooth scrolling to latest message when needed
  useEffect(() => {
    if (shouldScrollToLatest && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const messages = container.querySelectorAll('[data-message-id]');
      
      if (messages.length > 0) {
        const latestMessage = messages[messages.length - 1] as HTMLElement;
        
        // For subsequent messages (after the first exchange), scroll to show the latest message near the top
        if (submissionCount > 1) {
          // With the spacer, we want to position the message near the top of the visible area
          const containerRect = container.getBoundingClientRect();
          const messageRect = latestMessage.getBoundingClientRect();
          const currentRelativeTop = messageRect.top - containerRect.top;
          
          // Calculate where we want the message to be (40px from top of container)
          const targetRelativeTop = 40;
          const scrollDistance = currentRelativeTop - targetRelativeTop;
          
          // Smooth scroll animation
          const startScrollTop = container.scrollTop;
          const targetScrollTop = startScrollTop + scrollDistance;
          const distance = targetScrollTop - startScrollTop;
          const duration = 700;
          const startTime = performance.now();
          
          const animateScroll = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (easeInOutCubic)
            const easeProgress = progress < 0.5
              ? 4 * progress * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            
            container.scrollTop = startScrollTop + (distance * easeProgress);
            
            if (progress < 1) {
              requestAnimationFrame(animateScroll);
            } else {
              setShouldScrollToLatest(false);
            }
          };
          
          requestAnimationFrame(animateScroll);
        } else {
          // For the first message, just ensure it's visible
          latestMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
          setShouldScrollToLatest(false);
        }
      }
    }
  }, [shouldScrollToLatest, submissionCount]);

  const handleIntentSubmit = useCallback(async () => {
    if (!intentText.trim()) return;
    const currentIntent = intentText;
    const intentStartTime = performance.now();
    const intentCorrelationId = `intent-${Date.now()}`;
    
    console.log(`[Performance] ${intentCorrelationId} - Frontend:intent_submitted at 0.00ms`);
    
    // Store timing info for response measurement
    intentTimingRef.current = { startTime: intentStartTime, correlationId: intentCorrelationId };
    
    setSubmittedText(intentText);
    setIsSubmitting(true);
    
    // Clear suggested actions from previous query
    setSuggestedActions([]);
    
    // Don't clear the input immediately - let it fade out
    // setIntentText('');
    
    // Mark that we've submitted at least once
    setHasSubmittedOnce(true);
    setSubmissionCount(prev => prev + 1);
    
    // Hide placeholder immediately
    setShowPlaceholder(false);
    
    // Clear the input and reset submitting state after fade animation
    setTimeout(() => {
      setIntentText('');
      setIsSubmitting(false); // Make input visible again after fade
    }, 300);
    
    // Start thinking after a delay
    thinkingTimeoutRef.current = setTimeout(() => {
      console.log("[WelcomePage] Setting isThinking to true after 200ms delay");
      setIsThinking(true);
    }, 200);
    
    // Set context slices to loading state
    setContextSlices({ status: 'loading', data: null });
    
    // After 3 seconds delay, show "What's next?" placeholder with fade
    setTimeout(() => {
      setPlaceholderText("What's next?");
      // Start showing placeholder with opacity transition
      setTimeout(() => {
        setShowPlaceholder(true);
      }, 50); // Small delay to ensure placeholder text updates first
    }, 3000); // 3 second delay before fade-in starts

    setChatMessages(prevMessages => {
      const userMessage: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: currentIntent,
        createdAt: new Date(),
      };
      
      // Trigger scroll after messages update
      setTimeout(() => setShouldScrollToLatest(true), 50);
      
      if (prevMessages.length === 0 && fullGreeting) {
        return [
          { id: 'greeting-message', role: 'assistant', content: fullGreeting, createdAt: new Date(Date.now() - 1000) },
          userMessage
        ];
      }
      // Simplified: if greeting isn't the first message and fullGreeting exists, prepend it.
      // This path is unlikely if the first case handles it, but acts as a safeguard.
      if (fullGreeting && (!prevMessages.length || prevMessages[0].id !== 'greeting-message')) {
        return [
          { id: 'greeting-message', role: 'assistant', content: fullGreeting, createdAt: new Date(Date.now() - 1000) },
          ...prevMessages.filter(m => m.id !== 'greeting-message'), // Remove any other potential greeting messages
          userMessage
        ];
      }
      return [...prevMessages, userMessage];
    });

    console.log(`[WelcomePage] Submitting intent: "${currentIntent}"`);
    try {
      if (window.api?.setIntent) {
        await window.api.setIntent({ intentText: currentIntent, context: 'welcome' });
        // Refocus the intent line after submission
        setTimeout(() => {
          intentLineRef.current?.focus();
        }, 0);
      } else {
        console.warn("[WelcomePage] window.api.setIntent is not available.");
        setIsThinking(false);
        setChatMessages(prev => prev.filter(m => m.id !== `user-${Date.now()}` && m.id !== 'greeting-message'));
      }
    } catch (error) {
      console.error("Failed to set intent:", error);
      setIsThinking(false);
      // Don't reset isSubmitting here - let the timeout handle it
      setChatMessages(prev => [
        ...prev,
        { id: `error-submit-${Date.now()}`, role: 'assistant', content: "Error submitting your request.", createdAt: new Date() }
      ]);
    }
  }, [intentText, fullGreeting]);

  useEffect(() => {
    if (!window.api?.onIntentResult) {
      console.warn("[WelcomePage] window.api.onIntentResult is not available. Intent results will not be handled.");
      return;
    }

    const handleResult = (result: IntentResultPayload) => {
      console.log("[WelcomePage] Received intent result:", result);
      
      // Track intent response timing
      if (intentTimingRef.current) {
        const elapsed = performance.now() - intentTimingRef.current.startTime;
        console.log(`[Performance] ${intentTimingRef.current.correlationId} - Frontend:intent_result_received at ${elapsed.toFixed(2)}ms`, {
          resultType: result.type,
          hasSlices: !!(result.type === 'chat_reply' && result.slices?.length)
        });
        intentTimingRef.current = null; // Clear timing info
      }
      
      // Clear the thinking timeout if it hasn't fired yet
      if (thinkingTimeoutRef.current) {
        console.log("[WelcomePage] Clearing thinking timeout since we got a result");
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }
      
      console.log("[WelcomePage] Setting isThinking to false in onIntentResult handler, result type:", result.type);
      setIsThinking(false);
      // No need to reset anything here anymore
      
      // Reset placeholder for next interaction (unless navigating away)
      if (result.type !== 'open_notebook') {
        // Keep "What's next?" if we've already submitted once
        if (!hasSubmittedOnce) {
          setPlaceholderText("What would you like to find, organize, or do?");
        }
        setShowPlaceholder(true);
      }
      
      // Handle slices if this is a chat_reply with slices
      if (result.type === 'chat_reply' && result.slices) {
        setContextSlices({ status: 'loaded', data: result.slices });
      } else if (result.type === 'chat_reply') {
        // No slices returned, but still mark as loaded
        setContextSlices({ status: 'loaded', data: [] });
      } else if (result.type === 'error') {
        // Error case - reset slices to idle
        setContextSlices({ status: 'idle', data: null });
      }

      if (result.type === 'open_notebook' && result.notebookId) {
        // Reset context slices since we're navigating away
        setContextSlices({ status: 'idle', data: null });
        
        // Set navigating state to trigger animation to bottom
        setIsNavigatingToNotebook(true);
        // Show acknowledgment message if provided
        if (result.message) {
          setChatMessages(prevMessages => [...prevMessages, {
            id: `ack-${Date.now()}`,
            role: 'assistant',
            content: result.message || '',
            createdAt: new Date(),
          }]);
        }
        // Small delay to show intent line animation before navigation
        setTimeout(() => {
          router.push(`/notebook/${result.notebookId}`);
        }, 300); // Just enough time to see the intent line start moving
      } else if (result.type === 'chat_reply') {
        setChatMessages(prevMessages => {
          const assistantMessage: DisplayMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: result.message || '',
            createdAt: new Date(),
          };
          if (prevMessages.length === 0 && fullGreeting) {
            return [
              { id: 'greeting-message', role: 'assistant', content: fullGreeting, createdAt: new Date(Date.now() - 1000) },
              assistantMessage
            ];
          }
          if (fullGreeting && (!prevMessages.length || prevMessages[0].id !== 'greeting-message')) {
            return [
                { id: 'greeting-message', role: 'assistant', content: fullGreeting, createdAt: new Date(Date.now() - 1000) },
                ...prevMessages.filter(m => m.id !== 'greeting-message'),
                assistantMessage
            ];
          }
          return [...prevMessages, assistantMessage];
        });
      } else if (result.type === 'error') {
        setChatMessages(prevMessages => [...prevMessages, {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Sorry, an error occurred: ${result.message || 'Unknown error'}`,
          createdAt: new Date(),
        }]);
      } else if (result.type === 'open_url' && result.url) {
        // Reset context slices to show recent notebooks instead
        setContextSlices({ status: 'idle', data: null });
        
        // Show acknowledgment message if provided
        if (result.message) {
          setChatMessages(prevMessages => [...prevMessages, {
            id: `ack-${Date.now()}`,
            role: 'assistant',
            content: result.message || '',
            createdAt: new Date(),
          }]);
        }
        // Small delay to ensure message is visible before action
        setTimeout(() => {
          console.log("[WelcomePage] Opening WebLayer from intent result");
          setWebLayerInitialUrl(result.url);
          setIsWebLayerVisible(true);
        }, 100);
      }
    };

    const unsubscribe = window.api.onIntentResult(handleResult);
    return () => {
      unsubscribe();
    };
  }, [router, fullGreeting, hasSubmittedOnce]);

  // Add streaming handlers
  useEffect(() => {
    if (!window.api) {
      console.warn("[WelcomePage] window.api is not available. Streaming will not work.");
      return;
    }

    const unsubscribers: (() => void)[] = [];

    // Handle stream start
    if (window.api.onIntentStreamStart) {
      const unsubStart = window.api.onIntentStreamStart((data: { streamId: string }) => {
        console.log("[WelcomePage] Stream started:", data.streamId);
        setActiveStreamId(data.streamId);
        setStreamingMessage('');
        
        // Track streaming start timing
        if (intentTimingRef.current) {
          const elapsed = performance.now() - intentTimingRef.current.startTime;
          console.log(`[Performance] ${intentTimingRef.current.correlationId} - Frontend:stream_start at ${elapsed.toFixed(2)}ms`);
        }
      });
      unsubscribers.push(unsubStart);
    }

    // Handle stream chunks
    if (window.api.onIntentStreamChunk) {
      const unsubChunk = window.api.onIntentStreamChunk((data: { streamId: string; chunk: string }) => {
        if (data.streamId === activeStreamId) {
          setStreamingMessage(prev => prev + data.chunk);
        }
      });
      unsubscribers.push(unsubChunk);
    }

    // Handle stream end
    if (window.api.onIntentStreamEnd) {
      const unsubEnd = window.api.onIntentStreamEnd((data: { streamId: string; messageId?: string }) => {
        console.log("[WelcomePage] Stream ended:", data.streamId);
        
        if (data.streamId === activeStreamId) {
          // Track streaming end timing
          if (intentTimingRef.current) {
            const elapsed = performance.now() - intentTimingRef.current.startTime;
            console.log(`[Performance] ${intentTimingRef.current.correlationId} - Frontend:stream_end at ${elapsed.toFixed(2)}ms`);
            intentTimingRef.current = null;
          }
          
          // Add the complete message to chat
          const finalMessage = streamingMessage;
          if (finalMessage) {
            setChatMessages(prevMessages => {
              const assistantMessage: DisplayMessage = {
                id: data.messageId || `assistant-stream-${Date.now()}`,
                role: 'assistant',
                content: finalMessage,
                createdAt: new Date(),
              };
              return [...prevMessages, assistantMessage];
            });
          }
          
          // Clean up streaming state
          setActiveStreamId(null);
          setStreamingMessage('');
          console.log("[WelcomePage] Setting isThinking to false in stream end handler");
          setIsThinking(false);
          setShowPlaceholder(true);
          
          // Mark slices as loaded if we got them via ON_INTENT_RESULT
          if (contextSlices.status === 'loading') {
            setContextSlices(prev => ({ ...prev, status: 'loaded' }));
          }
        }
      });
      unsubscribers.push(unsubEnd);
    }

    // Handle stream error
    if (window.api.onIntentStreamError) {
      const unsubError = window.api.onIntentStreamError((data: { streamId?: string; error: string }) => {
        console.error("[WelcomePage] Stream error:", data);
        
        if (!data.streamId || data.streamId === activeStreamId) {
          // Track error timing
          if (intentTimingRef.current) {
            const elapsed = performance.now() - intentTimingRef.current.startTime;
            console.log(`[Performance] ${intentTimingRef.current.correlationId} - Frontend:stream_error at ${elapsed.toFixed(2)}ms`);
            intentTimingRef.current = null;
          }
          
          // Show error message
          setChatMessages(prevMessages => [...prevMessages, {
            id: `error-stream-${Date.now()}`,
            role: 'assistant',
            content: `Sorry, an error occurred: ${data.error}`,
            createdAt: new Date(),
          }]);
          
          // Clean up streaming state
          setActiveStreamId(null);
          setStreamingMessage('');
          console.log("[WelcomePage] Setting isThinking to false in stream error handler");
          setIsThinking(false);
          setShowPlaceholder(true);
          setContextSlices({ status: 'idle', data: null });
        }
      });
      unsubscribers.push(unsubError);
    }

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [activeStreamId, streamingMessage, contextSlices.status]);

  // Add listener for suggested actions
  useEffect(() => {
    if (!window.api?.onSuggestedActions) {
      console.warn("[WelcomePage] window.api.onSuggestedActions is not available.");
      return;
    }

    const unsubscribe = window.api.onSuggestedActions((actions: SuggestedAction[]) => {
      console.log("[WelcomePage] Received suggested actions:", actions);
      setSuggestedActions(actions);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleCloseWebLayer = useCallback(() => {
    console.log("[WelcomePage] handleCloseWebLayer called");
    setIsWebLayerVisible(false);
    setWebLayerInitialUrl(null);

    // Restore focus to intent line after a short delay
    setTimeout(() => {
      if (intentLineRef.current) {
        console.log("[WelcomePage] Restoring focus to IntentLine");
        intentLineRef.current.focus();
      }
    }, 100);
  }, []); // Empty dependency array ensures the function instance is stable

  const handleLinkClick = useCallback((href: string) => {
    console.log("[WelcomePage] handleLinkClick called with href:", href);
    setWebLayerInitialUrl(href);
    setIsWebLayerVisible(true);
  }, []);

  const handleComposeNotebook = useCallback(async () => {
    if (!composeTitle.trim()) {
      return;
    }

    setIsComposing(true);
    
    try {
      // Get source object IDs if we have context slices
      const sourceObjectIds = contextSlices.data
        ?.filter(slice => slice.sourceObjectId)
        .map(slice => slice.sourceObjectId!) || [];
      
      // Call the composition API (works with or without sources)
      const result = await window.api.composeNotebook({
        title: composeTitle.trim(),
        sourceObjectIds
      });
      
      // Close the dialog
      setIsComposeDialogOpen(false);
      
      // Navigate to the new notebook
      router.push(`/notebook/${result.notebookId}`);
      
    } catch (error) {
      console.error("[WelcomePage] Error composing notebook:", error);
      // Could show an error toast here
    } finally {
      setIsComposing(false);
    }
  }, [composeTitle, contextSlices.data, router]);

  // Fetch recently viewed notebooks on mount
  useEffect(() => {
    const fetchRecentNotebooks = async () => {
      try {
        if (window.api?.getRecentlyViewedNotebooks) {
          const notebooks = await window.api.getRecentlyViewedNotebooks();
          console.log('[WelcomePage] Fetched recent notebooks:', notebooks);
          setRecentNotebooks(notebooks);
        } else {
          console.warn("[WelcomePage] window.api.getRecentlyViewedNotebooks is not available.");
        }
      } catch (error) {
        console.error("Failed to fetch recent notebooks:", error);
      }
    };
    fetchRecentNotebooks();
  }, []);

  const handleSelectRecentNotebook = useCallback((notebookId: string) => {
    router.push(`/notebook/${notebookId}`);
  }, [router]);

  // Effect to measure greeting position
  useEffect(() => {
    const measureGreeting = () => {
      if (greetingRef.current && chatMessages.length === 0 && !isThinking) {
        const rect = greetingRef.current.getBoundingClientRect();
        setGreetingTopOffset(rect.top);
      }
    };

    // Measure on mount and when relevant states change
    measureGreeting();

    // Also measure on window resize
    window.addEventListener('resize', measureGreeting);
    return () => window.removeEventListener('resize', measureGreeting);
  }, [greetingPart, chatMessages.length, isThinking, isSubmitting]);

  const handleSuggestedAction = useCallback(async (action: SuggestedAction) => {
    console.log("[WelcomePage] Handling suggested action:", action);
    
    switch (action.type) {
      case 'open_notebook':
        if (action.payload.notebookId) {
          router.push(`/notebook/${action.payload.notebookId}`);
        }
        break;
        
      case 'compose_notebook':
        setComposeTitle(action.payload.proposedTitle || '');
        setIsComposeDialogOpen(true);
        break;
        
      case 'search_web':
        if (action.payload.searchQuery) {
          const searchUrl = action.payload.searchEngine === 'google' 
            ? `https://www.google.com/search?q=${encodeURIComponent(action.payload.searchQuery)}`
            : `https://www.perplexity.ai/search?q=${encodeURIComponent(action.payload.searchQuery)}`;
          
          setWebLayerInitialUrl(searchUrl);
          setIsWebLayerVisible(true);
        }
        break;
    }
  }, [router]);

  return (
    <motion.div 
      className="h-screen flex flex-col bg-step-2 text-step-12 relative overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: hasLoaded ? 1 : 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <CornerMasks />
      {/* Menu Button - Fixed Position at Bottom Right */} 
      <div className="fixed right-4 bottom-4 z-50">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-xl" aria-label="Main menu">
              ⋮
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent sideOffset={8} align="end">
            <DropdownMenuItem asChild><a href="/settings">Settings</a></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setIsUploadDialogOpen(true)}>Upload Bookmarks</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setIsPdfUploadDialogOpen(true)}>Upload PDFs</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main Grid Container */}
      <div className="flex-grow grid grid-cols-[2fr_1fr] h-full">
        
        {/* Left Column (chat / input / actions) */}
        <div className="relative flex flex-col h-full overflow-hidden">
          
          {/* Row 1: scrollable chat log / initial greeting */}
          <motion.div 
            className="overflow-y-auto px-16"
            ref={messagesContainerRef}
            initial={false}
            animate={{ 
              flex: isNavigatingToNotebook 
                ? "1 1 95%" // Almost full height when navigating to notebook
                : chatMessages.length > 0 || isThinking
                  ? "1 1 70%" // Keep expanded when there are messages or thinking
                  : "1 1 auto", // Only collapse when no messages and not thinking
            }}
            transition={{ 
              duration: isSubmitting && !hasSubmittedOnce ? 1.0 : 0.7, 
              ease: "easeInOut",
              delay: isSubmitting && !hasSubmittedOnce ? 0.2 : 0 // Only delay on first submission
            }}
          >
            {/* Static Greeting Display (only if chat is empty and not thinking) */} 
            {chatMessages.length === 0 && !isThinking && greetingPart && (
              <motion.div 
                className="flex flex-col justify-center h-full"
                initial={false}
                animate={{
                  y: isSubmitting ? "-40%" : 0,
                }}
                transition={{
                  duration: 0.5,
                  ease: "easeOut"
                }}
              >
                <p ref={greetingRef} className="text-lg">
                  <span className="text-step-11.5" style={{ paddingLeft: '0.5rem' }}>{greetingPart}.</span>{' '}
                  <span className="text-step-9">{weatherPart}</span>
                </p>
              </motion.div>
            )}
            {/* MessageList (only if chat has started or AI is thinking) */} 
            {(chatMessages.length > 0 || isThinking || streamingMessage) && (
              <>
                <MessageList
                  messages={
                    streamingMessage 
                      ? [...chatMessages, {
                          id: 'streaming-message',
                          role: 'assistant' as const,
                          content: streamingMessage,
                          createdAt: new Date()
                        }]
                      : chatMessages
                  }
                  isTyping={isThinking && !streamingMessage} 
                  showTimeStamp={false}
                  messageOptions={(message) => {
                    // Special animation for the greeting message
                    if (message.id === 'greeting-message') {
                      return { 
                        animation: "fade-slow",
                        className: "mt-20" // Adds 80px top margin
                      };
                    }
                    return { animation: "fade" };
                  }}
                  onLinkClick={handleLinkClick}
                />
                {/* Add some bottom padding to ensure scrollability */}
                <div style={{ minHeight: '100px' }} />
              </>
            )}
          </motion.div>

          {/* Row 2: Intent line (fixed height) */}
          <motion.div 
            className="px-16 pb-4 flex-shrink-0 h-[52px] relative z-10"
            initial={false}
            animate={{
              position: isNavigatingToNotebook ? "fixed" : "relative",
              bottom: isNavigatingToNotebook ? "16px" : "auto",
              left: isNavigatingToNotebook ? "64px" : "auto",
              width: isNavigatingToNotebook ? "calc(66.666667% - 128px)" : "auto",
              paddingLeft: isNavigatingToNotebook ? "0" : "64px",
              paddingRight: isNavigatingToNotebook ? "0" : "64px",
            }}
            transition={{ 
              duration: 0.7,
              ease: "easeInOut"
            }}
          >
            <div className="relative h-9">
              <IntentLine
                ref={intentLineRef}
                type="text"
                value={intentText}
                onChange={(e) => setIntentText(e.target.value)}
                transcribeAudio={window.api.audio.transcribe}
                placeholder={placeholderText}
                className={`w-full text-lg md:text-lg text-step-12 bg-transparent border-0 border-b-[1px] border-step-9 hover:border-step-11.5 focus:ring-0 focus:border-step-10 placeholder:text-step-12 ${showPlaceholder ? 'placeholder:opacity-100' : 'placeholder:opacity-0'} placeholder:transition-opacity placeholder:duration-[1500ms]`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleIntentSubmit(); }
                }}
                onFocus={() => {
                  console.log("[WelcomePage] IntentLine gained focus");
                }}
                onBlur={() => {
                  console.log("[WelcomePage] IntentLine lost focus");
                }}
                disabled={isThinking}
                autoFocus
                style={{
                  opacity: isSubmitting ? 0 : 1,
                  transition: 'opacity 0.3s ease-out'
                }}
              />
              {/* Show fading submitted text overlay - positioned exactly over the input */}
              {isSubmitting && submittedText && (
                <motion.div
                  className="absolute left-0 right-0 top-0 h-9 flex items-center px-3 text-lg md:text-lg text-step-12 pointer-events-none"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  {submittedText}
                </motion.div>
              )}
            </div>
          </motion.div>

          {/* Row 3: actions / library panel (28% height) */}
          <motion.div 
            className="px-16 py-4 overflow-y-auto"
            initial={false}
            animate={{ 
              flex: isNavigatingToNotebook 
                ? "0 0 5%" // Minimal height when navigating to notebook
                : chatMessages.length > 0 || isThinking
                  ? "0 0 30%" // Keep minimal when there are messages or thinking
                  : "0 0 50%" // Only expand when no messages and not thinking
            }}
            transition={{ 
              duration: isSubmitting && !hasSubmittedOnce ? 1.0 : 0.7, 
              ease: "easeInOut",
              delay: isSubmitting && !hasSubmittedOnce ? 0.2 : 0
            }}
          >
            {/* Show suggested actions only when loaded */}
            {suggestedActions.length > 0 && (
              <motion.div 
                className="flex flex-col gap-1.5 items-start"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                {suggestedActions.map((action, index) => (
                  <motion.button
                    key={index}
                    onClick={() => handleSuggestedAction(action)}
                    className="text-left bg-step-2 hover:bg-step-1 text-step-11-5 hover:text-birkin px-3 py-1.5 rounded-md transition-colors duration-200"
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: [0, 0.8, 1]
                    }}
                    transition={{ 
                      duration: 1.8,
                      delay: index * 0.1,
                      times: [0, 0.5, 1],
                      ease: "easeOut"
                    }}
                  >
                    {action.displayText}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </motion.div>
        </div>

        {/* Right Column (context slices or recent notebooks) */}
        <div className="bg-step-2 pr-2 pt-2 pb-2 h-full">
          <div className="bg-step-3 h-full p-4 overflow-y-auto flex justify-center">
            <div className="w-full max-w-2xl">
            {/* Show recent notebooks when no slices are available */}
            <AnimatePresence mode="wait">
              {(contextSlices.status === 'idle' || (contextSlices.status === 'loaded' && !contextSlices.data?.length)) ? (
                <motion.div
                  key="notebooks"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.7 }}
                >
                  <RecentNotebooksList 
                    notebooks={recentNotebooks}
                    onSelectNotebook={handleSelectRecentNotebook}
                    topOffset={greetingTopOffset}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="slices"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.7 }}
                >
                  <SliceContext 
                    contextState={contextSlices} 
                    isNotebookCover={true} 
                    onWebLayerOpen={handleLinkClick}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <BookmarkUploadDialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen} />
      <PdfUploadDialog open={isPdfUploadDialogOpen} onOpenChange={setIsPdfUploadDialogOpen} />
      {isWebLayerVisible && webLayerInitialUrl && (
        <WebLayer
          initialUrl={webLayerInitialUrl}
          isVisible={isWebLayerVisible}
          onClose={handleCloseWebLayer}
        />
      )}
      
      {/* Compose Notebook Dialog */}
      <Dialog open={isComposeDialogOpen} onOpenChange={setIsComposeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Notebook</DialogTitle>
            <DialogDescription>
              Give your notebook a title. The selected search results will be added as resources.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Input
              value={composeTitle}
              onChange={(e) => setComposeTitle(e.target.value)}
              placeholder="Enter notebook title..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isComposing && composeTitle.trim()) {
                  handleComposeNotebook();
                }
              }}
              disabled={isComposing}
              autoFocus
            />
          </div>
          
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsComposeDialogOpen(false)}
              disabled={isComposing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleComposeNotebook}
              disabled={!composeTitle.trim() || isComposing}
            >
              {isComposing ? "Creating..." : "Create Notebook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
