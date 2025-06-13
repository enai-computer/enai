"use client";

import { Globe } from "lucide-react";
import { TabState } from "../../../shared/types";
import { Favicon } from "./Favicon";

interface TabFaviconStackProps {
  tabs: TabState[];
  activeTabId: string;
  maxVisibleTabs?: number;
  size?: number;
}

interface TabPosition {
  zIndex: number;
  transform: string;
}

const TAB_POSITIONS: TabPosition[] = [
  { zIndex: 4, transform: "translate(0, 0) rotate(0deg)" }, // Active tab
  { zIndex: 3, transform: "translate(-2px, -2px) rotate(-6deg)" }, // Tab 2
  { zIndex: 2, transform: "translate(2px, -2px) rotate(6deg)" }, // Tab 3
  { zIndex: 1, transform: "translate(2px, 2px) rotate(10deg)" }, // Tab 4
  { zIndex: 0, transform: "translate(-2px, 2px) rotate(-10deg)" }, // Tab 5
];

export function TabFaviconStack({ 
  tabs, 
  activeTabId, 
  maxVisibleTabs = 4,
  size = 12 
}: TabFaviconStackProps) {
  // Find active tab and put it first
  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const otherTabs = tabs.filter(tab => tab.id !== activeTabId);
  
  // Sort tabs with active first
  const sortedTabs = activeTab 
    ? [activeTab, ...otherTabs.slice(0, maxVisibleTabs - 1)]
    : tabs.slice(0, maxVisibleTabs);
  
  // If only one tab, render it without stack effect
  if (sortedTabs.length === 1) {
    const tab = sortedTabs[0];
    return tab.faviconUrl ? (
      <Favicon 
        url={tab.faviconUrl} 
        fallback={<Globe className="h-4 w-4" />}
      />
    ) : (
      <Globe className="h-4 w-4" />
    );
  }
  
  // Render stack
  return (
    <div 
      className="relative inline-block" 
      style={{ 
        width: `${size + 8}px`, 
        height: `${size + 8}px` 
      }}
    >
      {sortedTabs.map((tab, index) => {
        const position = TAB_POSITIONS[index] || TAB_POSITIONS[0];
        
        return (
          <div
            key={tab.id}
            className="absolute top-1/2 left-1/2"
            style={{
              zIndex: position.zIndex,
              transform: `translate(-50%, -50%) ${position.transform}`,
              width: `${size}px`,
              height: `${size}px`,
              boxShadow: index > 0 ? "0 1px 2px rgba(0, 0, 0, 0.1)" : undefined,
            }}
          >
            {tab.faviconUrl ? (
              <Favicon 
                url={tab.faviconUrl} 
                fallback={<Globe className="h-3 w-3" />}
                className="h-full w-full object-contain"
              />
            ) : (
              <Globe className="h-3 w-3" />
            )}
          </div>
        );
      })}
    </div>
  );
}