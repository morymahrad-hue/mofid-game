const DEFAULT_CLOUD_BACKEND = 'https://ais-dev-sdzszqgdbodobsax6xrgtw-745640015071.us-east1.run.app';

export function getBackendBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  // Custom override saved by user in settings
  const customUrl = localStorage.getItem('mofidgame_backend_url');
  if (customUrl && customUrl.trim()) {
    return customUrl.trim().replace(/\/+$/, '');
  }

  const hostname = window.location.hostname;
  // If running locally or on Cloud Run directly, relative path /api works directly
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.run.app')) {
    return '';
  }

  // If running on GitHub Pages (*.github.io) or external static hosting, connect to Cloud Run backend
  return DEFAULT_CLOUD_BACKEND;
}

export function setCustomBackendUrl(url: string) {
  if (typeof window !== 'undefined') {
    if (url && url.trim()) {
      localStorage.setItem('mofidgame_backend_url', url.trim());
    } else {
      localStorage.removeItem('mofidgame_backend_url');
    }
  }
}

export async function apiFetch<T = any>(endpoint: string, options?: RequestInit): Promise<T> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const baseUrl = getBackendBaseUrl();
  const fullUrl = `${baseUrl}${cleanEndpoint}`;

  try {
    const res = await fetch(fullUrl, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options?.headers || {}),
      },
    });

    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();

    if (!rawText.trim()) {
      return { ok: res.ok } as unknown as T;
    }

    // If response is valid JSON or plain text representation
    if (contentType.includes('application/json') || (!rawText.trim().startsWith('<') && !rawText.trim().startsWith('<!'))) {
      try {
        return JSON.parse(rawText);
      } catch {
        return { ok: false, error: 'پاسخ سرور در قالب معتبر JSON نبود.', raw: rawText } as unknown as T;
      }
    }

    // If response was an HTML page (like a 404 from GitHub Pages)
    return {
      ok: false,
      isHtmlResponse: true,
      status: res.status,
      message: `خطای اتصال به سرور: پاسخ دریافتی به جای JSON یک صفحه HTML (${res.status}) بود. نشانی اتصال به بک‌اند ابری بررسی شد.`,
      error: `HTML response received (${res.status})`,
    } as unknown as T;
  } catch (netErr: any) {
    return {
      ok: false,
      message: `خطای اتصال به سرور: ${netErr.message || netErr}`,
      error: netErr.message || String(netErr),
    } as unknown as T;
  }
}
