"use client";

import { Home, MessageSquare, Globe } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
  SidebarGroup,
  SidebarGroupContent,
  SidebarSeparator,
  SidebarRail,
} from "@/components/ui/sidebar";

interface AppSidebarProps {
  onAddChat: () => void;
  onAddBrowser: () => void;
  onGoHome: () => void;
}

export function AppSidebar({ onAddChat, onAddBrowser, onGoHome }: AppSidebarProps) {
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
              <span>Donald Judd</span>
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
                  tooltip="Add New Browser"
                >
                  <Globe className="h-4 w-4" />
                  <span>New Browser</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
} 