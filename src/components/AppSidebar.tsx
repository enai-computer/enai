"use client";

import { Home, MessageSquare, Globe, MonitorIcon, FileText } from "lucide-react";
import { useState } from "react";
import { Note, NoteEditorPayload, WindowContentType } from "../../shared/types";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarSeparator,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { StoreApi } from "zustand";
import type { WindowStoreState } from "@/store/windowStoreFactory";
import type { WindowMeta, ClassicBrowserPayload } from "../../shared/types";

interface AppSidebarProps {
  onAddChat: () => void;
  onAddBrowser: () => void;
  onGoHome: () => void;
  windows?: WindowMeta[];
  activeStore?: StoreApi<WindowStoreState>;
  notebookId?: string;
}

function FaviconWithFallback({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);
  
  if (hasError) {
    return <>{fallback}</>;
  }
  
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img 
      src={url} 
      alt="" 
      className="h-4 w-4 object-contain"
      onError={() => setHasError(true)}
    />
  );
}

export function AppSidebar({ onAddChat, onAddBrowser, onGoHome, windows = [], activeStore, notebookId }: AppSidebarProps) {
  const minimizedWindows = windows.filter(w => w.isMinimized);
  
  const handleNewNote = () => {
    if (!activeStore || !notebookId) return;
    
    const payload: NoteEditorPayload = {
      notebookId,
    };
    
    activeStore.getState().addWindow({
      type: 'note_editor' as WindowContentType,
      payload,
      preferredMeta: {
        title: 'New Note',
        width: 600,
        height: 400,
      }
    });
  };
  
  const handleEditNote = (note: Note) => {
    if (!activeStore || !notebookId) return;
    
    const payload: NoteEditorPayload = {
      noteId: note.id,
      notebookId,
    };
    
    activeStore.getState().addWindow({
      type: 'note_editor' as WindowContentType,
      payload,
      preferredMeta: {
        title: 'Edit Note',
        width: 600,
        height: 400,
      }
    });
  };
  
  return (
    <Sidebar side="right" className="bg-step-5 border-step-6" collapsible="icon">
      <SidebarRail />
      <SidebarHeader className="py-4 px-2" style={{ paddingLeft: '9px' }}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton 
              onClick={onGoHome} 
              className="justify-start hover:bg-step-6"
              tooltip="Go to Home"
            >
              <Home className="h-4 w-4" />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      
      <SidebarSeparator className="bg-step-6" />
      
      <SidebarContent>
        <SidebarGroup style={{ paddingLeft: '9px' }}>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  onClick={onAddChat} 
                  className="hover:bg-step-6"
                  tooltip="Add New Chat"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>New Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  onClick={onAddBrowser} 
                  className="hover:bg-step-6"
                  tooltip="Surf the Web"
                >
                  <Globe className="h-4 w-4" />
                  <span>Surf the web</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  onClick={handleNewNote} 
                  className="hover:bg-step-6"
                  tooltip="Write a Note"
                >
                  <FileText className="h-4 w-4" />
                  <span>Write a note</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        {minimizedWindows.length > 0 && (
          <>
            <SidebarSeparator className="bg-step-6" />
            <SidebarGroup style={{ paddingLeft: '9px' }}>
              <SidebarGroupLabel>Minimized Windows</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {minimizedWindows.map((window) => {
                    const faviconUrl = window.type === 'classic-browser' 
                      ? (window.payload as ClassicBrowserPayload)?.faviconUrl 
                      : null;
                    
                    const renderIcon = () => {
                      if (window.type === 'classic-browser') {
                        if (faviconUrl) {
                          return (
                            <FaviconWithFallback 
                              url={faviconUrl} 
                              fallback={<Globe className="h-4 w-4" />}
                            />
                          );
                        }
                        return <Globe className="h-4 w-4" />;
                      }
                      
                      if (window.type === 'chat') {
                        return <MessageSquare className="h-4 w-4" />;
                      }
                      
                      return <MonitorIcon className="h-4 w-4" />;
                    };
                    
                    return (
                      <SidebarMenuItem key={window.id}>
                        <SidebarMenuButton
                          onClick={async () => {
                            await activeStore?.getState().restoreWindow(window.id);
                          }}
                          className="hover:bg-step-6"
                          tooltip={`Restore ${window.title}`}
                        >
                          {renderIcon()}
                          <span className="truncate">{window.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
        
      </SidebarContent>
    </Sidebar>
  );
} 