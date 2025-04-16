'use client'; // Required for hooks like useState, useEffect

import { useState, useEffect } from 'react';

export default function Home() {
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        console.log('Renderer: Calling window.api.getAppVersion()');
        // Check if window.api exists - it might not immediately during hot reloads/SSR attempts
        if (window.api) {
            const appVersion = await window.api.getAppVersion();
            console.log(`Renderer: Received version: ${appVersion}`);
            setVersion(appVersion);
        } else {
            console.warn('Renderer: window.api not found yet.');
            setError('API bridge not available yet. Please wait or refresh.');
            // Optionally retry after a short delay
        }
      } catch (err) {
        console.error('Renderer: Error fetching app version:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    };

    fetchVersion();
  }, []); // Empty dependency array ensures this runs once on mount

  return (
    <main style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Jeffers Environment</h1>
      <div>
        <h2>App Version:</h2>
        {error ? (
          <p style={{ color: 'red' }}>Error: {error}</p>
        ) : version ? (
          <p>v{version}</p>
        ) : (
          <p>Loading version...</p>
        )}
      </div>
      {/* Future components will go here */}
    </main>
  );
} 