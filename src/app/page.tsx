"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
import { IntentPayload, IntentResultPayload } from "../../shared/types";
import { WebLayer } from '@/components/apps/web-layer/WebLayer';

/**
 * Root page, now primarily displaying the chat interface.
 * Includes a menu for Settings and Upload Data.
 */
export default function WelcomePage() {
  const [intentText, setIntentText] = useState('');
  const [userName, setUserName] = useState<string>('friend'); // Default name
  const [greeting, setGreeting] = useState<string>('');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const router = useRouter();

  // WebLayer State
  const [webLayerInitialUrl, setWebLayerInitialUrl] = useState<string | null>(null);
  const [isWebLayerVisible, setIsWebLayerVisible] = useState<boolean>(false);

  // Fetch profile name
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        // Ensure window.api and window.api.getProfile are available
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
        // Keep default name if fetch fails
      }
    };
    fetchProfile();
  }, []);

  // Determine time of day for greeting
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
    // Using a simpler greeting for now, weather can be added later
    setGreeting(`Good ${timeOfDay}, ${userName}.`);
  }, [userName]);

  // --- Intent Submission & Result Handling ---
  const handleIntentSubmit = useCallback(async () => {
    if (!intentText.trim()) return;

    console.log(`[WelcomePage] Submitting intent: "${intentText}"`);
    try {
      // Ensure window.api and window.api.setIntent are available
      if (window.api?.setIntent) {
        await window.api.setIntent({ intentText });
        // For now, we don't do anything immediately after sending.
        // The result will be handled by the onIntentResult listener.
        // Optionally, clear the input or show a loading state here.
        // setIntentText(''); // Clearing is now handled based on intent result type
      } else {
        console.warn("[WelcomePage] window.api.setIntent is not available.");
      }
    } catch (error) {
      console.error("Failed to set intent:", error);
      // Display an error to the user if needed
    }
  }, [intentText]);

  useEffect(() => {
    // Ensure window.api and window.api.onIntentResult are available
    if (!window.api?.onIntentResult) {
      console.warn("[WelcomePage] window.api.onIntentResult is not available. Intent results will not be handled.");
      return;
    }
    // Step 3.5: Implement basic result handling and navigation
    const handleResult = (result: IntentResultPayload) => {
      console.log("[WelcomePage] Received intent result:", result);
      if (result.type === 'open_notebook' && result.notebookId) {
        router.push(`/notebook/${result.notebookId}`);
      } else if (result.type === 'chat_reply') {
        // For now, just log. Later, could display this on Welcome Page or open a quick chat.
        console.log("Chat reply received:", result.message);
      } else if (result.type === 'error') {
        console.error("Intent processing error:", result.message);
        // Display an error to the user
      } else if (result.type === 'open_url' && result.url) { // Handle open_url for WebLayer
        setWebLayerInitialUrl(result.url);
        setIsWebLayerVisible(true);
        setIntentText(''); // Clear the input field
      }
      // Handle other result types as needed
    };

    const unsubscribe = window.api.onIntentResult(handleResult);
    return () => {
      unsubscribe(); // Clean up listener on component unmount
    };
  }, [router]); // router is a dependency for navigation

  const handleCloseWebLayer = useCallback(() => {
    setIsWebLayerVisible(false);
    setWebLayerInitialUrl(null);
  }, []);

  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background text-foreground">
        <div className="w-full max-w-xl space-y-8">
          <div className="mb-8">
            <div className="p-2">
              <p className="text-2xl mb-1">{greeting}</p>
              <p className="text-sm text-muted-foreground">It's 68° and foggy in San Francisco.</p>
            </div>
          </div>

          <div className="absolute left-2 top-2"> {/* Positioned DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-xl" // No fixed positioning needed here as parent is absolute
                  aria-label="Main menu"
                >
                  ⋮
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent sideOffset={8} align="start">
                <DropdownMenuItem asChild>
                  <a href="/settings">Settings</a>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsUploadDialogOpen(true)}>
                  Upload Data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex w-full items-center space-x-2">
            <Input
              type="text"
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              placeholder="What would you like to find, organize, or do?"
              className="flex-grow text-lg p-2 bg-transparent border-0 border-b border-foreground/50 rounded-none focus:ring-0 focus:border-foreground focus-visible:ring-offset-0 focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleIntentSubmit();
                }
              }}
            />
            {/* Optional: Explicit submit button 
            <Button onClick={handleIntentSubmit} className="p-4 text-lg">
              Go
            </Button>
            */}
          </div>
          
          {/* Placeholder for where results might appear if not navigating immediately */}
          {/* <div className="mt-4 text-sm text-muted-foreground">
            Or explore your existing <a href="/library" className="underline">Library</a>.
          </div> */}
        </div>
        <BookmarkUploadDialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen} />
      </div>

      {/* Conditionally render WebLayer */}
      {isWebLayerVisible && webLayerInitialUrl && (
        <WebLayer
          initialUrl={webLayerInitialUrl}
          isVisible={isWebLayerVisible}
          onClose={handleCloseWebLayer}
        />
      )}
    </>
  );
}
