"use client";

import React, { useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TabState } from '../../../../shared/types';

interface TabProps {
  tab: TabState;
  isActive: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  isFocused: boolean; // Add prop to pass window focus state
  windowId: string; // Add windowId for context menu
  totalTabsCount: number; // Add total tabs count for canClose logic
}

const Tab: React.FC<TabProps> = ({ tab, isActive, onTabClick, onTabClose, isFocused, windowId, totalTabsCount }) => {
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTabClose(tab.id);
  }, [tab.id, onTabClose]);

  const handleClick = useCallback(() => {
    if (!isActive) {
      onTabClick(tab.id);
    }
  }, [tab.id, isActive, onTabClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Convert tab position to screen coordinates
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = rect.left + e.nativeEvent.offsetX;
    const screenY = rect.bottom; // Menu appears below tab

    const contextData = {
      x: screenX,
      y: screenY,
      windowId,
      contextType: 'tab' as const,
      tabContext: {
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: isActive,
        canClose: totalTabsCount > 1
      }
    };

    console.log('[TabBar] Showing tab context menu with data:', contextData);

    // Send to overlay system with tab context
    window.api?.browserContextMenu?.show(contextData);
  }, [tab, isActive, windowId, totalTabsCount]);

  // Get domain from URL for favicon fallback
  const getDomain = (url: string) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  };

  return (
    <div
      className={cn(
        "relative flex items-start pl-2 h-9 cursor-pointer transition-all duration-200 group pt-1.5",
        "max-w-[220px]",
        // Always match title bar color
        isFocused ? "bg-step-4" : "bg-step-3"
      )}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Pill container for content */}
      <div className={cn(
        "flex items-center gap-0.5 px-1 h-6 rounded transition-all duration-200 overflow-hidden",
        // Pill background colors
        isActive ? "bg-step-2" : 
        isFocused ? "bg-step-5 group-hover:bg-step-4" : "bg-step-4 group-hover:bg-step-3"
      )}
      style={{ borderRadius: '4px' }}>
        {/* Favicon */}
        {tab.faviconUrl ? (
          <img 
            src={tab.faviconUrl} 
            alt="" 
            className="w-3.5 h-3.5 flex-shrink-0"
            onError={(e) => {
              // Hide broken favicon
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-3.5 h-3.5 flex-shrink-0 bg-step-7 rounded-sm" />
        )}

        {/* Title */}
        <span className={cn(
          "text-xs truncate select-none min-w-0 ml-1",
          isActive ? "text-step-12" : "text-step-10"
        )}>
          {tab.title || getDomain(tab.url) || 'New Tab'}
        </span>

        {/* Close button */}
        <button
          onClick={handleClose}
          className={cn(
            "flex items-center justify-center w-3.5 h-3.5 rounded-sm transition-all flex-shrink-0",
            "opacity-0 group-hover:opacity-100",
            "hover:bg-step-1 text-step-11 hover:text-birkin"
          )}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  isFocused?: boolean; // Add prop to receive window focus state
  windowId: string; // Add windowId for context menu
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  isFocused = true,
  windowId
}) => {
  // Only show tab bar when there are multiple tabs
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <div className={cn(
      "overflow-hidden h-9",
      isFocused ? 'bg-step-4' : 'bg-step-3',
      isFocused ? 'opacity-100' : 'opacity-90'
    )}>
      <div className="inline-flex items-start overflow-x-auto scrollbar-hide h-full">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onTabClick={onTabClick}
            onTabClose={onTabClose}
            isFocused={isFocused}
            windowId={windowId}
            totalTabsCount={tabs.length}
          />
        ))}
        
        {/* New Tab button - now inside the scrollable area */}
        <div className="relative inline-flex items-start pl-2 h-9 pt-1.5">
          <button
            onClick={onNewTab}
            className={cn(
              "flex items-center justify-center w-6 h-6 rounded transition-colors",
              "hover:bg-step-2 hover:text-birkin",
              isFocused ? "text-step-11" : "text-step-9"
            )}
            style={{ borderRadius: '4px' }}
            title="New Tab"
          >
            <span className="text-sm leading-none">+</span>
          </button>
        </div>
      </div>
    </div>
  );
};