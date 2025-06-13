"use client";

import { Home, MessageSquare, Globe, MonitorIcon, FileText, LucideIcon } from "lucide-react";
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
import { Favicon } from "@/components/ui/Favicon";
import { TabFaviconStack } from "@/components/ui/TabFaviconStack";
import type { StoreApi } from "zustand";
import type { WindowStoreState } from "@/store/windowStoreFactory";
import type { WindowMeta, ClassicBrowserPayload } from "../../shared/types";

// Window type to icon mapping
const WINDOW_TYPE_ICONS: Record<WindowContentType, LucideIcon> = {
  'placeholder': MonitorIcon,
  'empty': MonitorIcon,
  'chat': MessageSquare,
  'browser': Globe,
  'classic-browser': Globe,
  'notebook_raw_editor': FileText,
  'note_editor': FileText,
};

interface AppSidebarProps {
  onAddChat: () => void;
  onAddBrowser: () => void;
  onGoHome: () => void;
  windows?: WindowMeta[];
  activeStore?: StoreApi<WindowStoreState>;
  notebookId?: string;
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
                    const renderIcon = () => {
                      // Special handling for classic-browser windows with favicons
                      if (window.type === 'classic-browser') {
                        const browserPayload = window.payload as ClassicBrowserPayload;
                        
                        // Use TabFaviconStack for multi-tab windows
                        if (browserPayload.tabs && browserPayload.tabs.length > 1) {
                          return (
                            <TabFaviconStack
                              tabs={browserPayload.tabs}
                              activeTabId={browserPayload.activeTabId}
                            />
                          );
                        }
                        
                        // Single tab or no tabs - use regular favicon
                        const activeTab = browserPayload.tabs?.find(t => t.id === browserPayload.activeTabId);
                        const faviconUrl = activeTab?.faviconUrl || null;
                        
                        if (faviconUrl) {
                          return (
                            <Favicon 
                              url={faviconUrl} 
                              fallback={<Globe className="h-4 w-4" />}
                            />
                          );
                        }
                      }
                      
                      // Use the icon mapping for all window types
                      const IconComponent = WINDOW_TYPE_ICONS[window.type] || MonitorIcon;
                      return <IconComponent className="h-4 w-4" />;
                    };
                    
                    return (
                      <SidebarMenuItem key={window.id}>
                        <SidebarMenuButton
                          onClick={async () => {
                            await activeStore?.getState().restoreWindow(window.id);
                          }}
                          className="hover:bg-step-6 group-data-[collapsible=icon]:justify-center"
                          tooltip={`Restore ${window.title}`}
                        >
                          {renderIcon()}
                          <span className="truncate group-data-[collapsible=icon]:hidden">{window.title}</span>
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