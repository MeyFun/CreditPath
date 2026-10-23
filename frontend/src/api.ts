import type {
  ApplicationDetail,
  ApplicationSummary,
  AuditItem,
  AuditVerification,
  DashboardData,
  EmployeeStats,
  NotificationItem,
  Product,
  RegistryCompany,
  ScoringConfig,
  TokenResponse,
  User
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const TOKEN_KEY = "creditpath_token";

export class ApiError extends Error {
  status: number;
  details?: { field: string; message: string }[];

  constructor(status: number, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(options.body instanceof FormData) && options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, "Сервис недоступен. Проверьте подключение и повторите попытку.");
  }
  if (response.status === 401 && token) {
    window.dispatchEvent(new Event("creditpath:auth-expired"));
  }
  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    let details: { field: string; message: string }[] | undefined;
    try {
      const payload = await response.json();
      if (typeof payload.detail === "string") message = payload.detail;
      else if (Array.isArray(payload.detail)) message = "Проверьте заполнение полей";
      details = payload.errors;
    } catch {
      // keep generic message
    }
    throw new ApiError(response.status, message, details);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function json(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<TokenResponse>("/auth/login", json({ username, password })),
    register: (payload: { username: string; password: string; full_name: string; company_inn?: string }) =>
      request<TokenResponse>("/auth/register", json(payload)),
    me: () => request<User>("/auth/me"),
    demoHint: () =>
      request<{ demo_mode: boolean; password_hint: string; accounts: string[] }>("/auth/demo-hint")
  },
  public: {
    products: () => request<Product[]>("/public/products"),
    registry: (inn: string) =>
      request<{ found: boolean; company: RegistryCompany; source: string; verified_at: string }>(
        `/public/registry/${inn}`
      ),
    schedule: (amount: number, rate: number, term_months: number) =>
      request<{ monthly_payment: number; total_payment: number; overpayment: number }>(
        `/public/payment-schedule?amount=${amount}&rate=${rate}&term_months=${term_months}`
      )
  },
  client: {
    dashboard: () => request<DashboardData>("/client/dashboard"),
    company: () => request<{ user: User; company: RegistryCompany | null; source: string | null }>("/client/company"),
    applications: (group = "all", search = "") =>
      request<ApplicationSummary[]>(
        `/client/applications?status_group=${group}${search ? `&search=${encodeURIComponent(search)}` : ""}`
      ),
    application: (id: number) => request<ApplicationDetail>(`/client/applications/${id}`),
    create: (payload: Record<string, unknown>) =>
      request<ApplicationDetail>("/client/applications", json(payload)),
    update: (id: number, payload: Record<string, unknown>) =>
      request<ApplicationDetail>(`/client/applications/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      }),
    submit: (
      id: number,
      key: string,
      body: { signer_position: string; authority_confirmed: boolean; consent_bki: boolean; consent_personal_data: boolean }
    ) =>
      request<ApplicationDetail>(`/client/applications/${id}/submit`, {
        method: "POST",
        headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }),
    respond: (id: number, payload: { comment: string; declared_revenue?: number; declared_profit?: number }) =>
      request<ApplicationDetail>(`/client/applications/${id}/respond`, json(payload)),
    offer: (id: number, accept: boolean) =>
      request<ApplicationDetail>(`/client/applications/${id}/offer`, json({ accept })),
    sign: (id: number) =>
      request<ApplicationDetail>(`/client/applications/${id}/sign`, { method: "POST" }),
    disburse: (id: number) =>
      request<ApplicationDetail>(`/client/applications/${id}/disburse`, { method: "POST" }),
    remove: (id: number) => request<void>(`/client/applications/${id}`, { method: "DELETE" }),
    resubmit: (id: number) =>
      request<ApplicationDetail>(`/client/applications/${id}/resubmit`, { method: "POST" }),
    upload: async (id: number, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<{ id: number; original_name: string; content_type: string; size_bytes: number; created_at: string }>(
        `/client/applications/${id}/documents`,
        { method: "POST", body: form }
      );
    }
  },
  notifications: {
    list: () => request<{ items: NotificationItem[]; unread: number }>("/notifications"),
    read: (id: number) => request<{ message: string }>(`/notifications/${id}/read`, { method: "POST" }),
    readAll: () => request<{ message: string }>("/notifications/read-all", { method: "POST" })
  },
  employee: {
    stats: () => request<EmployeeStats>("/employee/stats"),
    applications: (scope = "queue", search = "") =>
      request<ApplicationSummary[]>(
        `/employee/applications?scope=${scope}${search ? `&search=${encodeURIComponent(search)}` : ""}`
      ),
    application: (id: number) => request<ApplicationDetail>(`/employee/applications/${id}`),
    decide: (
      id: number,
      payload: {
        action: "approve" | "approve_changed" | "need_info" | "reject";
        product_id?: number;
        approved_amount?: number;
        approved_term_months?: number;
        comment?: string;
      }
    ) => request<ApplicationDetail>(`/employee/applications/${id}/decision`, json(payload))
  },
  admin: {
    users: (search = "", role = "") =>
      request<User[]>(`/admin/users?${search ? `search=${encodeURIComponent(search)}&` : ""}${role ? `role=${role}` : ""}`),
    changeRole: (id: number, role: "client" | "employee") =>
      request<User>(`/admin/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      }),
    applications: (params: { status?: string; unassigned?: boolean; search?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.status) query.set("status_filter", params.status);
      if (params.unassigned) query.set("unassigned", "true");
      if (params.search) query.set("search", params.search);
      return request<ApplicationSummary[]>(`/admin/applications?${query.toString()}`);
    },
    application: (id: number) => request<ApplicationDetail>(`/admin/applications/${id}`),
    assign: (id: number, employeeId: number) =>
      request<ApplicationDetail>(`/admin/applications/${id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ employee_id: employeeId })
      }),
    audit: (params: { action?: string; limit?: number; offset?: number } = {}) => {
      const query = new URLSearchParams();
      if (params.action) query.set("action", params.action);
      query.set("limit", String(params.limit ?? 100));
      query.set("offset", String(params.offset ?? 0));
      return request<AuditItem[]>(`/admin/audit?${query.toString()}`);
    },
    verifyAudit: () => request<AuditVerification>("/admin/audit/verify"),
    products: () => request<Product[]>("/admin/products"),
    updateProduct: (id: number, payload: Record<string, unknown>) =>
      request<Product>(`/admin/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    scoringConfig: () => request<ScoringConfig>("/admin/scoring-config"),
    scoringHistory: () => request<ScoringConfig[]>("/admin/scoring-config/history"),
    updateScoringConfig: (config: Record<string, unknown>) =>
      request<ScoringConfig>("/admin/scoring-config", json({ config }))
  }
};

export async function downloadDocument(applicationId: number, documentId: number, filename: string, role: string) {
  const prefix =
    role === "employee"
      ? `/employee/applications/${applicationId}/documents/${documentId}`
      : role === "admin"
        ? `/admin/applications/${applicationId}/documents/${documentId}`
        : `/client/applications/${applicationId}/documents/${documentId}`;
  const response = await fetch(`${API_BASE}${prefix}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` }
  });
  if (!response.ok) throw new ApiError(response.status, "Не удалось скачать документ");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
