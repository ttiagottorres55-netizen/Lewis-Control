import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User 
} from 'firebase/auth';

// Explicit configuration matching firebase-applet-config.json
const firebaseConfig = {
  projectId: "gen-lang-client-0194646957",
  appId: "1:688427448770:web:6450b9cc79593579d1fe5b",
  apiKey: "AIzaSyDiMzlBbpyabPMK887YhWDnAi0Hs85gpCs",
  authDomain: "gen-lang-client-0194646957.firebaseapp.com",
  storageBucket: "gen-lang-client-0194646957.firebasestorage.app",
  messagingSenderId: "688427448770",
};

export const OAUTH_CLIENT_ID = "688427448770-lbmoveakh7kjelksomt7ghvhbnkkdfa9.apps.googleusercontent.com";
export const REQUIRED_SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

// In-memory + persistent localStorage caching so Google account stays connected permanently
const STORAGE_ACCESS_TOKEN = 'google_access_token';
const STORAGE_TOKEN_TIME = 'google_token_timestamp';
const STORAGE_USER_EMAIL = 'google_user_email';

let isSigningIn = false;
let isRefreshing = false;
let cachedAccessToken: string | null = (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_ACCESS_TOKEN) : null);

const tokenListeners = new Set<(newToken: string) => void>();

export const onTokenRefreshed = (listener: (newToken: string) => void) => {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
};

function notifyTokenListeners(token: string) {
  cachedAccessToken = token;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_ACCESS_TOKEN, token);
    localStorage.setItem(STORAGE_TOKEN_TIME, Date.now().toString());
  }
  for (const listener of tokenListeners) {
    try {
      listener(token);
    } catch (e) {
      console.error('Error in token listener:', e);
    }
  }
}

// Google Identity Services (GSI) Token Client for silent token refresh in background
let gsiTokenClient: any = null;

export function getGsiTokenClient(onSuccess?: (token: string) => void, onError?: (err: any) => void) {
  if (typeof window === 'undefined') return null;
  if (!window.google?.accounts?.oauth2) return null;

  gsiTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: OAUTH_CLIENT_ID,
    scope: REQUIRED_SCOPES,
    callback: (response: any) => {
      if (response && response.access_token) {
        notifyTokenListeners(response.access_token);
        if (onSuccess) onSuccess(response.access_token);
      } else if (response && response.error) {
        console.warn('GSI token request returned error:', response.error);
        if (onError) onError(new Error(response.error));
      }
    },
    error_callback: (error: any) => {
      console.warn('GSI client error:', error);
      if (onError) onError(error);
    }
  });

  return gsiTokenClient;
}

/**
 * Automatically refreshes the Google OAuth access token without disconnecting or prompting the user.
 * Can be called silently in the background or during API retries.
 */
export const refreshGoogleToken = async (silent = true): Promise<string | null> => {
  if (isRefreshing) {
    // Wait briefly if a refresh is already in flight
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return cachedAccessToken || localStorage.getItem(STORAGE_ACCESS_TOKEN);
  }

  isRefreshing = true;
  try {
    // 1. Try silent refresh via Google Identity Services client if available
    const token = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 7000);

      try {
        const client = getGsiTokenClient(
          (newToken) => {
            clearTimeout(timeout);
            resolve(newToken);
          },
          () => {
            clearTimeout(timeout);
            resolve(null);
          }
        );

        if (client) {
          client.requestAccessToken({ prompt: silent ? '' : 'select_account' });
        } else {
          clearTimeout(timeout);
          resolve(null);
        }
      } catch (err) {
        clearTimeout(timeout);
        resolve(null);
      }
    });

    if (token) {
      return token;
    }

    // 2. If silent refresh via GSI was not possible and not strictly silent, use signInWithPopup
    if (!silent && !isSigningIn) {
      const res = await googleSignIn();
      return res?.accessToken || null;
    }

    // Fall back to current cached token
    return cachedAccessToken || localStorage.getItem(STORAGE_ACCESS_TOKEN);
  } finally {
    isRefreshing = false;
  }
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const currentToken = cachedAccessToken || localStorage.getItem(STORAGE_ACCESS_TOKEN);
      if (currentToken) {
        if (onAuthSuccess) onAuthSuccess(user, currentToken);
      } else if (!isSigningIn) {
        // Try silent refresh immediately on app startup
        const refreshed = await refreshGoogleToken(true);
        if (refreshed && onAuthSuccess) {
          onAuthSuccess(user, refreshed);
        } else if (onAuthFailure) {
          onAuthFailure();
        }
      }
    } else {
      // If Firebase user is not signed in, check if we have stored token
      const currentToken = cachedAccessToken || localStorage.getItem(STORAGE_ACCESS_TOKEN);
      if (!currentToken && onAuthFailure) {
        onAuthFailure();
      }
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('No se pudo obtener el token de acceso de Google.');
    }

    notifyTokenListeners(credential.accessToken);
    if (result.user.email) {
      localStorage.setItem(STORAGE_USER_EMAIL, result.user.email);
    }
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_ACCESS_TOKEN) : null;
  if (stored) {
    cachedAccessToken = stored;
    return stored;
  }
  return null;
};

export const clearCachedToken = () => {
  cachedAccessToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_TOKEN_TIME);
  }
};

export const logoutGoogle = async () => {
  await signOut(auth);
  clearCachedToken();
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_USER_EMAIL);
  }
};
