"use client";

import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { BookmarkUploadDialog } from "@/components/BookmarkUploadDialog";

/**
 * Root "Welcome / Command Palette" screen.
 * Displays a time-of-day greeting, a command input, and a kebab menu that
 * links to Settings and Upload Data pages.
 */
export default function Home() {
  const [username, setUsername] = useState("friend");
  const [greeting, setGreeting] = useState("Hello");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // Fetch profile once.
  useEffect(() => {
    // Typing `window.api` keeps the renderer sandbox-safe.
    window.api?.getProfile?.().then(
      (u: { name?: string }) => u?.name && setUsername(u.name)
    );
  }, []);

  // Derive greeting from current hour.
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  // Autofocus the command box on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative h-screen flex flex-col items-center justify-center gap-8 p-8">
      {/* Kebab menu (top-left) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-4 text-xl"
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
            Upload data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Greeting */}
      <h1 className="text-3xl font-medium text-center">
        {greeting}, {username}.
      </h1>

      {/* Command input */}
      <Input
        ref={inputRef}
        placeholder="What would you like to do?"
        className="w-full max-w-lg text-lg"
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            const command = e.currentTarget.value.trim();
            if (command) {
              console.log("command:", command); // TODO: ipcRenderer.invoke("command:run", command)
              e.currentTarget.value = "";
            }
          }
        }}
      />

      <BookmarkUploadDialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen} />
    </div>
  );
}
