"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Clock, Notebook, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { WeatherIcon } from "@/components/ui/weather-icon";
import { WeatherData, RecentNotebook } from "../../../shared/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter, useParams } from "next/navigation";

interface NotebookInfoPillProps {
  title: string;
  className?: string;
  onTitleChange?: (newTitle: string) => void;
  parentZIndex?: number;
}

export function NotebookInfoPill({ title, className = "", onTitleChange, parentZIndex = 5 }: NotebookInfoPillProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [recentNotebooks, setRecentNotebooks] = useState<RecentNotebook[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const params = useParams();
  const currentNotebookId = params?.notebookId as string;
  
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    
    return () => clearInterval(timer);
  }, []);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Update edit value when title prop changes
  useEffect(() => {
    setEditValue(title);
  }, [title]);
  
  // Fetch weather data on mount
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        if (window.api?.getWeather) {
          const weather = await window.api.getWeather();
          setWeatherData(weather);
        }
      } catch (error) {
        console.error("Failed to fetch weather:", error);
      }
    };
    fetchWeather();
  }, []);

  // Fetch notebooks when dropdown opens
  useEffect(() => {
    if (!isDropdownOpen) return;
    
    const fetchRecentNotebooks = async () => {
      try {
        if (window.api?.getRecentlyViewedNotebooks) {
          const notebooks = await window.api.getRecentlyViewedNotebooks();
          setRecentNotebooks(notebooks);
        }
      } catch (error) {
        console.error("Failed to fetch recent notebooks:", error);
      }
    };
    
    fetchRecentNotebooks();
    
    // Trigger parent clicked state when dropdown opens
    const pillContainer = document.querySelector('.notebook-info-pill-container');
    if (pillContainer) {
      pillContainer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }, [isDropdownOpen]);

  const handleSelectNotebook = useCallback((notebookId: string) => {
    if (notebookId === currentNotebookId) return;
    router.push(`/notebook/${notebookId}`);
    setIsDropdownOpen(false);
  }, [currentNotebookId, router]);

  const handleCreateNotebook = useCallback(async () => {
    try {
      if (window.api?.composeNotebook) {
        const result = await window.api.composeNotebook({
          title: "Untitled Notebook",
          sourceObjectIds: []
        });
        router.push(`/notebook/${result.notebookId}`);
        setIsDropdownOpen(false);
      }
    } catch (error) {
      console.error("Failed to create notebook:", error);
    }
  }, [router]);
  
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const getRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) {
      return 'just now';
    } else if (minutes < 60) {
      return `${minutes}m`;
    } else if (hours < 24) {
      return `${hours}h`;
    } else if (days < 30) {
      return `${days}d`;
    } else {
      return new Date(timestamp).toLocaleDateString();
    }
  };

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== title) {
      onTitleChange?.(trimmedValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };
  
  return (
    <div 
      className={`inline-flex items-center gap-2 px-3 py-1.5 bg-step-2 text-step-11 hover:bg-step-4 hover:text-step-12 hover:shadow-md rounded-md text-sm font-medium cursor-pointer transition-all duration-200 ${isEditing ? 'min-w-fit' : ''} ${className}`} 
      style={{ 
        borderRadius: '6px',
        width: isEditing ? 'auto' : undefined,
        '--dropdown-z-index': parentZIndex
      } as React.CSSProperties}
    >
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <button 
            className="p-0 border-0 bg-transparent hover:bg-transparent focus:outline-none focus-visible:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <Notebook className="w-3.5 h-3.5 transition-colors duration-200 hover:text-birkin" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="start" 
          className="w-64 notebook-dropdown"
          onMouseEnter={() => {
            // Trigger parent hover state when dropdown is open
            const pillContainer = document.querySelector('.notebook-info-pill-container');
            if (pillContainer) {
              pillContainer.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            }
          }}
        >
          <DropdownMenuLabel>Recent Notebooks</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {recentNotebooks.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              No recent notebooks
            </div>
          ) : (
            recentNotebooks.map((notebook) => {
              const isCurrentNotebook = notebook.id === currentNotebookId;
              return (
                <DropdownMenuItem
                  key={notebook.id}
                  onClick={() => handleSelectNotebook(notebook.id)}
                  disabled={isCurrentNotebook}
                  className={isCurrentNotebook ? 'bg-step-2' : ''}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="truncate font-medium">
                      {notebook.title}
                      {isCurrentNotebook && <span className="text-step-9 ml-1 font-normal">(current)</span>}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {getRelativeTime(notebook.lastAccessed)}
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCreateNotebook}>
            <Plus className="mr-2 h-4 w-4" />
            New Notebook
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isEditing ? (
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="h-auto px-1 py-0 text-sm bg-transparent border-0 border-b border-step-6 focus:border-step-8 focus:ring-0 focus-visible:ring-0 min-w-[150px] w-auto"
          style={{ 
            lineHeight: 'inherit',
            fontSize: 'inherit',
            fontFamily: 'inherit',
            width: `${Math.max(150, editValue.length * 8)}px`
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span 
          className="truncate max-w-[200px] hover:text-birkin transition-colors cursor-text" 
          onDoubleClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          title="Double-click to edit"
        >
          {title}
        </span>
      )}
      <span className="text-step-9 transition-colors duration-200">•</span>
      <span className="flex items-center gap-1 hover:text-birkin transition-colors">
        <Clock className="w-3 h-3 transition-colors duration-200" />
        {formatTime(currentTime)}
      </span>
      <span className="text-step-9 transition-colors duration-200">•</span>
      <span className="hover:text-birkin transition-colors flex items-center gap-1">
        {weatherData ? (
          <>
            {/* <WeatherIcon icon={weatherData.icon} size={16} className="opacity-90" /> */}
            {weatherData.temperature}°
          </>
        ) : (
          '68°'
        )}
      </span>
    </div>
  );
}