export interface AdminApplication {
  id: string;
  app_id: string;
  name: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface ApplicationInput {
  app_id: string;
  name: string;
  description?: string;
}

export interface AdminPackage {
  id: string;
  app_id: string;
  name: string;
  price: number;
  billing_cycle: string;
  features?: string[] | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface PackageInput {
  app_id: string;
  name: string;
  price: number;
  billing_cycle: string;
  features?: string[];
}

export interface AdminSubscription {
  id: string;
  user_id: string;
  package_id: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
  package?: AdminPackage | null;
}

import { clearAdminToken, getAdminToken } from './auth';

const BASE_URL = '/api/v1/admin';

// The backend requires every /api/v1/admin/* request (other than /login) to
// carry a Bearer JWT whose payload has an admin claim (is_admin: true or
// role: "admin") — see POST /api/v1/admin/login and api/dependencies.py.
function authHeaders(): HeadersInit {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      // Token missing/expired/rejected — clear it and send the admin back to login.
      clearAdminToken();
      window.location.href = '/login';
    }
    let errMsg = `API error: ${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.detail) {
        errMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
      }
    } catch (_) {}
    throw new Error(errMsg);
  }
  return res.json();
}

export async function fetchAdminApplications(): Promise<AdminApplication[]> {
  const res = await fetch(`${BASE_URL}/applications`, { headers: authHeaders() });
  return handleResponse<AdminApplication[]>(res);
}

export async function createAdminApplication(input: ApplicationInput): Promise<AdminApplication> {
  const res = await fetch(`${BASE_URL}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<AdminApplication>(res);
}

export async function fetchAdminPackages(appId?: string): Promise<AdminPackage[]> {
  const url = appId ? `${BASE_URL}/packages?app_id=${encodeURIComponent(appId)}` : `${BASE_URL}/packages`;
  const res = await fetch(url, { headers: authHeaders() });
  return handleResponse<AdminPackage[]>(res);
}

export async function createAdminPackage(input: PackageInput): Promise<AdminPackage> {
  const res = await fetch(`${BASE_URL}/packages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<AdminPackage>(res);
}

export async function updateAdminPackage(id: string, input: Partial<PackageInput>): Promise<AdminPackage> {
  const res = await fetch(`${BASE_URL}/packages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<AdminPackage>(res);
}

export async function deleteAdminPackage(id: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/packages/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse<{ message: string }>(res);
}

export async function fetchAdminSubscriptions(): Promise<AdminSubscription[]> {
  const res = await fetch(`${BASE_URL}/subscriptions`, { headers: authHeaders() });
  return handleResponse<AdminSubscription[]>(res);
}

export async function updateAdminSubscriptionStatus(
  subscriptionId: string,
  status: string
): Promise<AdminSubscription> {
  const res = await fetch(`${BASE_URL}/subscriptions/${subscriptionId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ status }),
  });
  return handleResponse<AdminSubscription>(res);
}
