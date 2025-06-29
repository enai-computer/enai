
// services/browser/url.helpers.ts

/**
 * Check if a URL is an OAuth/authentication URL that should open in a popup
 */
export function isAuthenticationUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    
    // Common OAuth/SSO patterns
    const authPatterns = [
      // Google OAuth
      'accounts.google.com',
      'accounts.youtube.com',
      
      // GitHub OAuth
      'github.com/login',
      
      // Microsoft/Azure
      'login.microsoftonline.com',
      'login.microsoft.com',
      'login.live.com',
      
      // Facebook
      'facebook.com/login',
      'facebook.com/dialog/oauth',
      
      // Twitter/X
      'twitter.com/oauth',
      'x.com/oauth',
      
      // LinkedIn
      'linkedin.com/oauth',
      
      // Generic OAuth patterns
      '/oauth/',
      '/auth/',
      '/signin',
      '/login',
      '/sso/',
      'storagerelay://' // Google's OAuth relay
    ];
    
    // Check hostname
    if (authPatterns.some(pattern => hostname.includes(pattern))) {
      return true;
    }
    
    // Check pathname
    if (authPatterns.some(pattern => pathname.includes(pattern))) {
      return true;
    }
    
    // Check for OAuth2 query parameters
    const hasOAuthParams = urlObj.searchParams.has('client_id') || 
                          urlObj.searchParams.has('redirect_uri') ||
                          urlObj.searchParams.has('response_type') ||
                          urlObj.searchParams.has('scope');
    
    return hasOAuthParams;
  } catch {
    return false;
  }
}

/**
 * Check if a URL is from an ad/tracking/analytics domain
 */
export function isAdOrTrackingUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Common ad/tracking/analytics patterns
    const adPatterns = [
      // Ad networks
      'doubleclick', 'googlesyndication', 'googleadservices', 'googletag',
      'adsystem', 'adsrvr', 'adnxs', 'adsafeprotected', 'amazon-adsystem',
      'facebook.com/tr', 'fbcdn.net', 'moatads', 'openx', 'pubmatic',
      'rubicon', 'scorecardresearch', 'serving-sys', 'taboola', 'outbrain',
      
      // Analytics/tracking
      'google-analytics', 'googletagmanager', 'analytics', 'omniture',
      'segment.', 'mixpanel', 'hotjar', 'mouseflow', 'clicktale',
      'newrelic', 'pingdom', 'quantserve', 'comscore', 'chartbeat',
      
      // User sync/cookie matching
      'sync.', 'match.', 'pixel.', 'cm.', 'rtb.', 'bidder.',
      'partners.tremorhub', 'ad.turn', 'mathtag', 'bluekai',
      'demdex', 'exelator', 'eyeota', 'tapad', 'rlcdn', 'rfihub',
      'casalemedia', 'contextweb', 'districtm', 'sharethrough',
      
      // Other common patterns
      'metric.', 'telemetry.', 'tracking.', 'track.', 'tags.',
      'stats.', 'counter.', 'log.', 'logger.', 'collect.',
      'beacon.', 'pixel', 'impression', '.ads.', 'adserver',
      'creative.', 'banner.', 'popup.', 'pop.', 'affiliate'
    ];
    
    // Domain starts that are typically ads/tracking
    const domainStarts = [
      'ad.', 'ads.', 'adsdk.', 'adx.', 'analytics.', 'stats.',
      'metric.', 'telemetry.', 'tracking.', 'track.', 'pixel.',
      'sync.', 'match.', 'rtb.', 'ssp.', 'dsp.', 'cm.'
    ];
    
    // Check if hostname starts with any ad pattern
    if (domainStarts.some(start => hostname.startsWith(start))) {
      return true;
    }
    
    // Check if hostname contains any ad pattern
    if (adPatterns.some(pattern => hostname.includes(pattern))) {
      return true;
    }
    
    // Check path for common tracking endpoints
    const pathPatterns = ['/pixel', '/sync', '/match', '/track', '/collect', '/beacon', '/impression'];
    if (pathPatterns.some(pattern => urlObj.pathname.includes(pattern))) {
      return true;
    }
    
    return false;
  } catch {
    // If URL parsing fails, don't filter it out
    return false;
  }
}
