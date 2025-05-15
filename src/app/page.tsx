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
import { Input } from "@/components/ui/input";
import { IntentResultPayload } from "../../shared/types";
import { WebLayer } from '@/components/apps/web-layer/WebLayer';
import { MessageList } from "@/components/ui/message-list";

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
  const messagesContainerRef = useRef<HTMLDivElement>(null);

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
        await window.api.setIntent({ intentText: currentIntent });
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
        setChatMessages([]);
        router.push(`/notebook/${result.notebookId}`);
      } else if (result.type === 'chat_reply') {
        setChatMessages(prevMessages => {
          const assistantMessage: DisplayMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: result.message,
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
          content: `Sorry, an error occurred: ${result.message}`,
          createdAt: new Date(),
        }]);
      } else if (result.type === 'open_url' && result.url) {
        setWebLayerInitialUrl(result.url);
        setIsWebLayerVisible(true);
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

  return (
    <div className="h-screen flex flex-col bg-background text-foreground relative">
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
        <div className="relative grid grid-rows-[1fr_auto_50%] border-r border-border">
          
          {/* Row 1: scrollable chat log / initial greeting */}
          <div className="overflow-y-auto px-4" ref={messagesContainerRef}>
            {/* Static Greeting Display (only if chat is empty and not thinking) */} 
            {chatMessages.length === 0 && !isThinking && fullGreeting && (
              <div className="pt-4 pb-2"> {/* Padding to visually position greeting within this 1fr block */}
                <p className="text-xl">{fullGreeting}</p>
              </div>
            )}
            {/* MessageList (only if chat has started or AI is thinking) */} 
            {(chatMessages.length > 0 || isThinking) && (
              <MessageList
                messages={chatMessages} // This will include the greeting as its first item
                isTyping={isThinking} 
                showTimeStamp={false}
                messageOptions={{ animation: "fade" }}
              />
            )}
          </div>

          {/* Row 2: Intent line (auto height) */}
          <div className="px-4 pb-4"> {/* Removed my added pt-2, sticking to user example */}
            <Input
              type="text"
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              placeholder="What would you like to find, organize, or do?"
              className="w-full text-lg bg-transparent border-0 border-b-2 border-foreground/30 focus:ring-0 focus:border-foreground placeholder-foreground/70"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleIntentSubmit(); }
              }}
              disabled={isThinking}
            />
          </div>

          {/* Row 3: actions / library panel (28% height) */}
          <div className="p-4 bg-muted/20 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Actions or library will go here later.
            </p>
          </div>
        </div>

        {/* Right Column (context slices) */}
        <div className="p-4 bg-muted/10 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
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
    </div>
  );
}
