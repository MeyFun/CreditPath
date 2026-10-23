export type Role = "client" | "employee" | "admin";

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  company_inn: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface Purpose {
  code: string;
  label: string;
}

export interface Product {
  id: number;
  code: string;
  name: string;
  short_description: string;
  description: string;
  min_amount: number;
  max_amount: number;
  min_term_months: number;
  max_term_months: number;
  rate: number;
  min_business_age_months: number;
  requires_collateral: boolean;
  revenue_limit_ratio: number;
  purposes: Purpose[];
  is_active: boolean;
  sort_order: number;
}

export interface EmployeeMini {
  id: number;
  full_name: string;
  role: Role;
}

export interface ApplicationSummary {
  id: number;
  number: string;
  status: string;
  status_label: string;
  client_status: string;
  product: Product;
  company_inn: string | null;
  company_name: string | null;
  amount: number;
  term_months: number;
  purpose: string;
  purpose_label: string;
  collateral: boolean;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  scoring_score: number | null;
  final_outcome: string | null;
  approved_amount: number | null;
  approved_term_months: number | null;
  approved_rate: number | null;
  assigned_employee: EmployeeMini | null;
  queue_reason: string | null;
  previous_application_id: number | null;
  documents_count: number;
}

export interface Event {
  id: number;
  event_type: string;
  status_from: string | null;
  status_to: string | null;
  actor_role: string;
  comment: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface DocumentItem {
  id: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface ScoringFactor {
  code: string;
  label: string;
  points: number;
  reason: string;
  value?: unknown;
}

export interface ScoringResult {
  score: number;
  factors: ScoringFactor[];
  reasons: string[];
  negative_reasons: string[];
  positive_reasons: string[];
  calculated_at: string;
}

export interface DecisionDraft {
  outcome: "approve" | "approve_changed" | "need_info" | "reject";
  summary: string;
  reasons: string[];
  score?: number;
  proposed_amount?: number;
  proposed_term_months?: number;
  proposed_rate?: number;
  stop_factors?: string[];
}

export interface RegistryCompany {
  inn: string;
  name: string;
  legal_form: string;
  registration_date: string;
  status: string;
  okved: string;
  okved_name: string;
  director: string;
  address: string;
  founders: { name: string; share: number }[];
  authorized_capital: number;
  revenue: number | null;
  profit: number | null;
  employees: number | null;
  financial_year: number;
  is_financial_data_available?: boolean;
  financial_source?: string;
}

export interface BkiRecord {
  inn: string;
  company_name: string;
  credit_history_found: boolean;
  current_debt: number;
  active_overdue: boolean;
  current_overdue_amount: number;
  max_overdue_days: number;
  closed_overdue_12m: boolean;
  closed_overdue_last: string | null;
  credit_history_years: number;
  contracts_paid: number;
  contracts_active: number;
  history: { date: string; type: string; amount: number; status: string }[];
}

export interface ApplicationDetail extends ApplicationSummary {
  scoring: ScoringResult | null;
  decision_draft: DecisionDraft | null;
  employee_comment: string | null;
  decision_by: EmployeeMini | null;
  declared_revenue: number | null;
  declared_profit: number | null;
  client_comment: string | null;
  offer_expires_at: string | null;
  accepted_at: string | null;
  signed_at: string | null;
  disbursed_at: string | null;
  events: Event[];
  documents: DocumentItem[];
  registry_snapshot: RegistryCompany | null;
  bki_snapshot: BkiRecord | null;
  enrichment_errors: Record<string, unknown> | null;
  can_edit: boolean;
  can_submit: boolean;
  can_respond: boolean;
  can_accept_offer: boolean;
  can_decline_offer: boolean;
  can_sign: boolean;
  can_disburse: boolean;
  can_resubmit: boolean;
  can_decide: boolean;
  previous_decisions: PreviousDecision[];
  related_party: boolean;
}

export interface DashboardData {
  applications: ApplicationSummary[];
  counts: Record<string, number>;
  total_approved_amount: number;
  unread_notifications: number;
  company: RegistryCompany | null;
}

export interface NotificationItem {
  id: number;
  application_id: number | null;
  title: string;
  body: string;
  kind: string;
  is_read: boolean;
  created_at: string;
}

export interface AuditItem {
  id: number;
  created_at: string;
  actor_id: number | null;
  actor_label: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  previous_hash: string;
  entry_hash: string;
}

export interface AuditVerification {
  valid: boolean;
  checked: number;
  broken_at: number | null;
  message: string;
}

export interface ScoringConfig {
  id: number;
  version: number;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface EmployeeStats {
  in_review: number;
  need_info: number;
  total_assigned: number;
  approved_total: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface ApiErrorPayload {
  detail?: string;
  errors?: { field: string; message: string }[];
}

export interface NewsTargeting {
  okved_prefixes: string[];
  opf: string[];
  products: string[];
  statuses: string[];
  max_age_months: number | null;
}

export interface PreviousDecision {
  id: number;
  number: string;
  status: string;
  status_label: string;
  amount: number;
  submitted_at: string | null;
  decided_by: EmployeeMini | null;
  employee_comment: string | null;
}

export interface ClientNewsItem {
  id: number;
  title: string;
  body: string;
  category: string;
  published_at: string;
  personal: boolean;
  reasons: string[];
}

export interface ClientNewsFeed {
  profile: {
    opf: string | null;
    okved: string | null;
    okved_name: string | null;
    age_months: number | null;
    statuses: string[];
    products: string[];
  };
  items: ClientNewsItem[];
}

export interface AdminNewsItem {
  id: number;
  title: string;
  body: string;
  category: string;
  targeting: Partial<NewsTargeting>;
  is_active: boolean;
  published_at: string;
}
