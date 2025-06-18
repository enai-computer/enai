"use client";

import { useEffect, useState, useRef } from "react";
import { Clock, Notebook } from "lucide-react";
import { Input } from "@/components/ui/input";
import { WeatherIcon } from "@/components/ui/weather-icon";
import { WeatherData } from "../../../shared/types";

interface NotebookInfoPillProps {
  title: string;
  className?: string;
  onTitleChange?: (newTitle: string) => void;
}

export function NotebookInfoPill({ title, className = "", onTitleChange }: NotebookInfoPillProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
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
  
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
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
        width: isEditing ? 'auto' : undefined
      }}
    >
      <Notebook className="w-3.5 h-3.5 transition-colors duration-200 hover:text-birkin" />
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
            <WeatherIcon icon={weatherData.icon} size={16} className="opacity-90" />
            {weatherData.temperature}°
          </>
        ) : (
          '68°'
        )}
      </span>
    </div>
  );
}