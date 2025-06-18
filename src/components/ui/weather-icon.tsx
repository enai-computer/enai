"use client";

import React from 'react';
import { WeatherIconType } from '../../../shared/types';

interface WeatherIconProps {
  icon: WeatherIconType;
  size?: number;
  className?: string;
}

export function WeatherIcon({ icon, size = 20, className = "" }: WeatherIconProps) {
  const baseClass = `inline-block ${className}`;
  
  // Google Weather icon mapping with simplified SVG representations
  const iconMap: Record<WeatherIconType, JSX.Element> = {
    // Clear conditions
    'sunny': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    ),
    
    'clear_night': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    ),
    
    // Partially cloudy
    'partly_cloudy_day': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <circle cx="12" cy="10" r="3"/>
        <line x1="12" y1="2" x2="12" y2="4"/>
        <line x1="18.36" y1="5.64" x2="17.27" y2="6.73"/>
        <line x1="20" y1="12" x2="18" y2="12"/>
      </svg>
    ),
    
    'partly_cloudy_night': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <path d="M20 4a4 4 0 1 1-8 0 3 3 0 0 0 8 0z"/>
      </svg>
    ),
    
    // Cloudy conditions
    'cloudy': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
      </svg>
    ),
    
    'mostly_cloudy_day': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="currentColor" fillOpacity="0.3"/>
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
      </svg>
    ),
    
    'mostly_cloudy_night': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="currentColor" fillOpacity="0.3"/>
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
      </svg>
    ),
    
    'overcast': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="currentColor" fillOpacity="0.5"/>
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
      </svg>
    ),
    
    // Rain conditions
    'light_rain': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <line x1="8" y1="19" x2="8" y2="21" strokeWidth="1.5"/>
        <line x1="12" y1="19" x2="12" y2="21" strokeWidth="1.5"/>
        <line x1="16" y1="19" x2="16" y2="21" strokeWidth="1.5"/>
      </svg>
    ),
    
    'moderate_rain': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <line x1="8" y1="19" x2="8" y2="21"/>
        <line x1="8" y1="13" x2="8" y2="15"/>
        <line x1="16" y1="19" x2="16" y2="21"/>
        <line x1="16" y1="13" x2="16" y2="15"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="12" y1="15" x2="12" y2="17"/>
      </svg>
    ),
    
    'heavy_rain': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <line x1="8" y1="19" x2="8" y2="21" strokeWidth="2.5"/>
        <line x1="8" y1="13" x2="8" y2="15" strokeWidth="2.5"/>
        <line x1="16" y1="19" x2="16" y2="21" strokeWidth="2.5"/>
        <line x1="16" y1="13" x2="16" y2="15" strokeWidth="2.5"/>
        <line x1="12" y1="21" x2="12" y2="23" strokeWidth="2.5"/>
        <line x1="12" y1="15" x2="12" y2="17" strokeWidth="2.5"/>
      </svg>
    ),
    
    'freezing_rain': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <circle cx="8" cy="21" r="0.5" fill="currentColor"/>
        <circle cx="12" cy="21" r="0.5" fill="currentColor"/>
        <circle cx="16" cy="21" r="0.5" fill="currentColor"/>
        <line x1="8" y1="17" x2="8" y2="19"/>
        <line x1="12" y1="17" x2="12" y2="19"/>
        <line x1="16" y1="17" x2="16" y2="19"/>
      </svg>
    ),
    
    'showers_rain': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <line x1="6" y1="19" x2="7" y2="21"/>
        <line x1="10" y1="19" x2="11" y2="21"/>
        <line x1="14" y1="19" x2="15" y2="21"/>
        <line x1="18" y1="19" x2="19" y2="21"/>
      </svg>
    ),
    
    'heavy_showers_rain': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <line x1="6" y1="19" x2="7" y2="21" strokeWidth="2.5"/>
        <line x1="10" y1="19" x2="11" y2="21" strokeWidth="2.5"/>
        <line x1="14" y1="19" x2="15" y2="21" strokeWidth="2.5"/>
        <line x1="18" y1="19" x2="19" y2="21" strokeWidth="2.5"/>
      </svg>
    ),
    
    // Drizzle
    'drizzle': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <circle cx="8" cy="20" r="0.5" fill="currentColor"/>
        <circle cx="12" cy="20" r="0.5" fill="currentColor"/>
        <circle cx="16" cy="20" r="0.5" fill="currentColor"/>
        <circle cx="10" cy="22" r="0.5" fill="currentColor"/>
        <circle cx="14" cy="22" r="0.5" fill="currentColor"/>
      </svg>
    ),
    
    'heavy_drizzle': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <circle cx="7" cy="19" r="0.7" fill="currentColor"/>
        <circle cx="11" cy="19" r="0.7" fill="currentColor"/>
        <circle cx="15" cy="19" r="0.7" fill="currentColor"/>
        <circle cx="9" cy="21" r="0.7" fill="currentColor"/>
        <circle cx="13" cy="21" r="0.7" fill="currentColor"/>
        <circle cx="17" cy="21" r="0.7" fill="currentColor"/>
      </svg>
    ),
    
    // Thunderstorm
    'thunderstorm': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/>
        <polyline points="13 11 9 17 15 17 11 23"/>
      </svg>
    ),
    
    'thunderstorm_rain': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/>
        <polyline points="13 11 9 17 15 17 11 23"/>
        <line x1="6" y1="19" x2="6" y2="21"/>
        <line x1="18" y1="19" x2="18" y2="21"/>
      </svg>
    ),
    
    'heavy_thunderstorm': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9" fill="currentColor" fillOpacity="0.3"/>
        <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/>
        <polyline points="13 11 9 17 15 17 11 23" strokeWidth="2.5"/>
      </svg>
    ),
    
    // Snow conditions
    'light_snow': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <circle cx="8" cy="20" r="0.5" fill="currentColor"/>
        <circle cx="12" cy="22" r="0.5" fill="currentColor"/>
        <circle cx="16" cy="20" r="0.5" fill="currentColor"/>
      </svg>
    ),
    
    'moderate_snow': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <path d="M12 21v-2m0-2v.01M8 21v-2m0-2v.01M16 21v-2m0-2v.01" strokeLinecap="round"/>
      </svg>
    ),
    
    'heavy_snow': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <path d="M8 16L6 18L8 20M16 16L18 18L16 20M12 14L12 22M9 17L15 21M15 17L9 21" strokeWidth="1.5"/>
      </svg>
    ),
    
    'blizzard': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="currentColor" fillOpacity="0.3"/>
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <path d="M8 16L6 18L8 20M16 16L18 18L16 20M12 14L12 22M9 17L15 21M15 17L9 21" strokeWidth="2.5"/>
      </svg>
    ),
    
    'snow_showers': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <circle cx="6" cy="20" r="0.7" fill="currentColor"/>
        <circle cx="10" cy="20" r="0.7" fill="currentColor"/>
        <circle cx="14" cy="20" r="0.7" fill="currentColor"/>
        <circle cx="18" cy="20" r="0.7" fill="currentColor"/>
        <path d="M8 22L10 22M14 22L16 22" strokeLinecap="round"/>
      </svg>
    ),
    
    'flurries': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <circle cx="8" cy="19" r="0.3" fill="currentColor"/>
        <circle cx="12" cy="21" r="0.3" fill="currentColor"/>
        <circle cx="16" cy="19" r="0.3" fill="currentColor"/>
        <circle cx="10" cy="21" r="0.3" fill="currentColor"/>
        <circle cx="14" cy="20" r="0.3" fill="currentColor"/>
      </svg>
    ),
    
    // Mixed precipitation
    'sleet': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <line x1="8" y1="19" x2="8" y2="20.5"/>
        <circle cx="8" cy="21.5" r="0.5" fill="currentColor"/>
        <line x1="12" y1="19" x2="12" y2="20.5"/>
        <circle cx="12" cy="21.5" r="0.5" fill="currentColor"/>
        <line x1="16" y1="19" x2="16" y2="20.5"/>
        <circle cx="16" cy="21.5" r="0.5" fill="currentColor"/>
      </svg>
    ),
    
    'snow_rain_mix': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
        <line x1="8" y1="19" x2="8" y2="21"/>
        <circle cx="12" cy="20" r="0.5" fill="currentColor"/>
        <line x1="16" y1="19" x2="16" y2="21"/>
      </svg>
    ),
    
    // Atmospheric conditions
    'mist': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M5 8h14M5 16h14" strokeOpacity="0.6"/>
      </svg>
    ),
    
    'fog': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" strokeOpacity="0.5"/>
        <path d="M3 18h18M5 22h14" strokeOpacity="0.6"/>
      </svg>
    ),
    
    'haze': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" strokeOpacity="0.5"/>
        <path d="M3 12h18M12 3v18" strokeOpacity="0.3"/>
      </svg>
    ),
    
    'smoke': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 16c0-2.21 1.79-4 4-4s4 1.79 4 4M6 20c0-3.31 2.69-6 6-6s6 2.69 6 6" strokeOpacity="0.6"/>
        <path d="M12 12V8" strokeDasharray="2 2"/>
      </svg>
    ),
    
    'dust': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="12" r="1" fillOpacity="0.5" fill="currentColor"/>
        <circle cx="16" cy="10" r="1" fillOpacity="0.5" fill="currentColor"/>
        <circle cx="12" cy="15" r="1" fillOpacity="0.5" fill="currentColor"/>
        <circle cx="6" cy="18" r="1" fillOpacity="0.5" fill="currentColor"/>
        <circle cx="18" cy="16" r="1" fillOpacity="0.5" fill="currentColor"/>
        <path d="M3 12h3M18 12h3" strokeOpacity="0.4"/>
      </svg>
    ),
    
    'sand': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h18" strokeDasharray="3 3" strokeOpacity="0.6"/>
        <path d="M5 16h14" strokeDasharray="3 3" strokeOpacity="0.6"/>
        <path d="M7 8h10" strokeDasharray="3 3" strokeOpacity="0.6"/>
        <circle cx="12" cy="12" r="2" fillOpacity="0.4" fill="currentColor"/>
      </svg>
    ),
    
    // Extreme conditions
    'tornado': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 4H3M20 8H6M19 12H9M17 16H11M15 20H13"/>
      </svg>
    ),
    
    'hurricane': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.19 0 2.34-.21 3.41-.6"/>
        <path d="M2 12c0-1.19.21-2.34.6-3.41"/>
        <path d="M12 22c5.52 0 10-4.48 10-10 0-1.19-.21-2.34-.6-3.41"/>
        <path d="M22 12c0 1.19-.21 2.34-.6 3.41"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    ),
  };
  
  return (
    <span className={baseClass} style={{ width: size, height: size }}>
      {iconMap[icon] || iconMap['cloudy']}
    </span>
  );
}