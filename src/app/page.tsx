"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { BookmarkUploadDialog } from "@/components/BookmarkUploadDialog";
import { useRouter } from "next/navigation";
import { IntentLine } from "@/components/ui/intent-line";
import { IntentResultPayload } from "../../shared/types";
import { WebLayer } from '@/components/apps/web-layer/WebLayer';
import { MessageList } from "@/components/ui/message-list";
import { motion } from "framer-motion";

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
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const router = useRouter();

  const [webLayerInitialUrl, setWebLayerInitialUrl] = useState<string | null>(null);
  const [isWebLayerVisible, setIsWebLayerVisible] = useState<boolean>(false);

  const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [isNavigatingToNotebook, setIsNavigatingToNotebook] = useState<boolean>(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const intentLineRef = useRef<HTMLInputElement>(null);
  const [hasLoaded, setHasLoaded] = useState(false);


  // Trigger fade-in animation on mount
  useEffect(() => {
    setHasLoaded(true);
  }, []);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        if (window.api?.getProfile) {
          const profile = await window.api.getProfile();
          if (profile && profile.name) {
            setUserName(profile.name);
          }
        } else {
          console.warn("[WelcomePage] window.api.getProfile is not available.");
        }
      } catch (error) {
        console.error("Failed to fetch profile:", error);
      }
    };
    fetchProfile();
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
    setFullGreeting(`${dynamicGreeting}. It's 68° and foggy in San Francisco.`);
  }, [userName]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [chatMessages, isThinking]);

  const handleIntentSubmit = useCallback(async () => {
    if (!intentText.trim()) return;
    const currentIntent = intentText;
    setIntentText('');
    setIsThinking(true);

    setChatMessages(prevMessages => {
      const userMessage: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: currentIntent,
        createdAt: new Date(),
      };
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
      setIsThinking(false);

      if (result.type === 'open_notebook' && result.notebookId) {
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
        // Delay navigation slightly to show the message and animation
        setTimeout(() => {
          setChatMessages([]);
          router.push(`/notebook/${result.notebookId}`);
        }, 500);
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
          setWebLayerInitialUrl(result.url);
          setIsWebLayerVisible(true);
        }, 100);
      }
    };

    const unsubscribe = window.api.onIntentResult(handleResult);
    return () => {
      unsubscribe();
    };
  }, [router, fullGreeting]);

  const handleCloseWebLayer = useCallback(() => {
    setIsWebLayerVisible(false);
    setWebLayerInitialUrl(null);
  }, []);

  const handleLinkClick = useCallback((href: string) => {
    console.log("[WelcomePage] Link clicked:", href);
    setWebLayerInitialUrl(href);
    setIsWebLayerVisible(true);
  }, []);

  return (
    <motion.div 
      className="h-screen flex flex-col bg-step-1 text-step-12 relative overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: hasLoaded ? 1 : 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      {/* Menu Button - Absolutely Positioned */} 
      <div className="absolute left-4 top-4 z-20">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-xl" aria-label="Main menu">
              ⋮
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent sideOffset={8} align="start">
            <DropdownMenuItem asChild><a href="/settings">Settings</a></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setIsUploadDialogOpen(true)}>Upload Data</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main Grid Container (takes full height below menu, menu overlays this container's padding) */}
      <div className="flex-grow grid grid-cols-[2fr_1fr] pt-16"> {/* pt-16 for menu offset */}
        
        {/* Left Column (chat / input / actions) */}
        <div className="relative flex flex-col h-full">
          
          {/* Row 1: scrollable chat log / initial greeting */}
          <motion.div 
            className="overflow-y-auto px-19"
            ref={messagesContainerRef}
            layout
            initial={false}
            animate={{ 
              flex: isNavigatingToNotebook 
                ? "0 0 95%" // Almost full height when navigating to notebook
                : chatMessages.length > 0 
                  ? "0 0 70%" // Keep expanded when there are messages
                  : isThinking
                    ? "0 0 70%" // Expand when thinking
                    : "1 1 0%" // Only collapse when no messages and not thinking
            }}
            transition={{ 
              duration: 0.7, 
              ease: "easeInOut"
            }}
          >
            {/* Static Greeting Display (only if chat is empty and not thinking) */} 
            {chatMessages.length === 0 && !isThinking && fullGreeting && (
              <div className="pt-4 pb-2"> {/* Padding to visually position greeting within this 1fr block */}
                <p className="text-l">{fullGreeting}</p>
              </div>
            )}
            {/* MessageList (only if chat has started or AI is thinking) */} 
            {(chatMessages.length > 0 || isThinking) && (
              <MessageList
                messages={chatMessages} // This will include the greeting as its first item
                isTyping={isThinking} 
                showTimeStamp={false}
                messageOptions={{ animation: "fade" }}
                onLinkClick={handleLinkClick}
              />
            )}
          </motion.div>

          {/* Row 2: Intent line (auto height) */}
          <div className="px-16 pb-4 flex-shrink-0"> {/* Removed my added pt-2, sticking to user example */}
            <IntentLine
              ref={intentLineRef}
              type="text"
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              placeholder="What would you like to find, organize, or do?"
              className="w-full text-lg bg-transparent border-0 border-b-2 border-step-12/30 focus:ring-0 focus:border-step-12/50 placeholder-foreground/70"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleIntentSubmit(); }
              }}
              disabled={isThinking}
            />
          </div>

          {/* Row 3: actions / library panel (28% height) */}
          <motion.div 
            className="p-4 bg-step-1/20 overflow-y-auto"
            layout
            initial={false}
            animate={{ 
              flex: isNavigatingToNotebook 
                ? "1 1 0%" // Minimal height when navigating to notebook
                : chatMessages.length > 0 
                  ? "1 1 0%" // Keep minimal when there are messages
                  : isThinking
                    ? "1 1 0%" // Minimize when thinking
                    : "0 0 50%" // Only expand when no messages and not thinking
            }}
            transition={{ 
              duration: 0.7, 
              ease: "easeInOut"
            }}
          >
            <p className="text-sm text-step-10/20">
              Actions or library will go here later.
            </p>
          </motion.div>
        </div>

        {/* Right Column (context slices) */}
        <div className="p-4 bg-step-2/10 overflow-y-auto">
          <p className="text-sm text-step-10/20">
            Context slices will go here later.
          </p>
        </div>
      </div>

      <BookmarkUploadDialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen} />
      {isWebLayerVisible && webLayerInitialUrl && (
        <WebLayer
          initialUrl={webLayerInitialUrl}
          isVisible={isWebLayerVisible}
          onClose={handleCloseWebLayer}
        />
      )}
    </motion.div>
  );
}
