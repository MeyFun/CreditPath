import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileText,
  Info,
  LoaderCircle,
  Route,
  X
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from "react";
import { createPortal } from "react-dom";
import type { Event } from "../types";

export function formatMoney(value: number | null | undefined, fraction = 0): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: fraction,
    minimumFractionDigits: fraction
  }).format(value) + " ₽";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatPercent(value: number | null | undefined, fraction = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(fraction).replace(",", ".").replace(/\.0$/, "")}%`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="logo">
      <span className="logo-mark" aria-hidden="true">
        <Route size={22} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span className="logo-text">
          <strong className="logo-name">CreditPath</strong>
          <small className="logo-tagline">кредитный кабинет для бизнеса</small>
        </span>
      )}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

export function Button({
  variant = "primary",
  loading = false,
  icon,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      className={`btn btn-${variant} ${className}`.trim()}
      {...props}
      disabled={loading || props.disabled}
    >
      {loading ? <LoaderCircle className="spin" size={18} /> : icon}
      <span>{children}</span>
    </button>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "div"
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>;
}

export function Field({
  label,
  hint,
  error,
  children,
  required
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label} {required && <em>*</em>}
      </span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select-wrap">
      <select className={`input select ${className}`.trim()} {...props}>
        {children}
      </select>
      <ChevronDown size={16} aria-hidden="true" />
    </div>
  );
}

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Черновик", tone: "neutral" },
  SUBMITTED: { label: "Заявка отправлена", tone: "info" },
  VALIDATION: { label: "Идёт проверка", tone: "info" },
  ENRICHMENT: { label: "Идёт проверка", tone: "info" },
  SCORING: { label: "Идёт проверка", tone: "info" },
  DECISION_DRAFT: { label: "Идёт проверка", tone: "info" },
  IN_REVIEW: { label: "На рассмотрении", tone: "info" },
  NEED_INFO: { label: "Нужны уточнения", tone: "warning" },
  APPROVED: { label: "Одобрено", tone: "success" },
  APPROVED_CHANGED: { label: "Одобрено на других условиях", tone: "success" },
  REJECTED: { label: "Отказ", tone: "danger" },
  OFFER_ACCEPTED: { label: "Оферта принята", tone: "success" },
  OFFER_DECLINED: { label: "Оферта отклонена", tone: "neutral" },
  SIGNED: { label: "Договор подписан", tone: "success" },
  DISBURSED: { label: "Средства перечислены", tone: "success" }
};

const PIPELINE_STATUSES = ["SUBMITTED", "VALIDATION", "ENRICHMENT", "SCORING", "DECISION_DRAFT"];

/** Как часто опрашивать заявку: быстро на автопроверках, реже пока ждём сотрудника или клиента. */
export function applicationPollInterval(status: string | undefined): number | false {
  if (!status) return false;
  if (PIPELINE_STATUSES.includes(status)) return 2000;
  if (status === "IN_REVIEW" || status === "NEED_INFO") return 5000;
  return false;
}

/** Единая шкала прогресса заявки: список и карточка показывают одинаковый процент. */
export function applicationProgress(status: string): number {
  if (status === "DRAFT") return 5;
  if (status === "SUBMITTED") return 15;
  if (PIPELINE_STATUSES.includes(status)) return 35;
  if (status === "IN_REVIEW" || status === "NEED_INFO") return 60;
  if (status === "APPROVED" || status === "APPROVED_CHANGED") return 75;
  if (status === "OFFER_ACCEPTED") return 85;
  if (status === "SIGNED") return 95;
  return 100;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const item = STATUS_MAP[status] ?? { label: label ?? status, tone: "neutral" };
  return (
    <span className={`badge badge-${item.tone}`}>
      <span className="badge-dot" />
      {label ?? item.label}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <LoaderCircle className="spin" size={size} aria-label="Загрузка" />;
}

export function FullPageLoader({ label = "Загружаем данные…" }: { label?: string }) {
  return (
    <div className="full-loader">
      <Spinner size={28} />
      <span>{label}</span>
    </div>
  );
}

export function LoadingBlock({ label = "Загружаем данные…" }: { label?: string }) {
  return (
    <div className="loading-block">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** Ошибка загрузки вместо пустой таблицы или вечного лоадера. */
export function ErrorState({ title = "Не удалось загрузить данные", onRetry }: { title?: string; onRetry?: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={<CircleAlert size={24} />}
        title={title}
        description="Проверьте соединение и повторите попытку."
        action={onRetry && <Button variant="secondary" onClick={onRetry}>Повторить</Button>}
      />
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <FileText size={24} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  const Icon = tone === "success" ? CircleCheck : tone === "warning" ? Clock3 : tone === "danger" ? CircleAlert : Info;
  return (
    <div className={`alert alert-${tone}`}>
      <Icon size={19} className="alert-icon" />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export interface StepItem {
  title: string;
  description?: string;
}

export function Stepper({ steps, current }: { steps: StepItem[]; current: number }) {
  return (
    <ol className="stepper">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <li key={step.title} className={`stepper-item stepper-${state}`}>
            <span className="stepper-number">{state === "done" ? <Check size={16} /> : index + 1}</span>
            <span className="stepper-copy">
              <strong>{step.title}</strong>
              {step.description && <small>{step.description}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressBar({ value, tone = "accent" }: { value: number; tone?: string }) {
  return (
    <div className={`progress progress-${tone}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  DRAFT_CREATED: "Черновик создан",
  APPLICATION_SUBMITTED: "Заявка отправлена",
  VALIDATION_PASSED: "Данные проверены",
  ENRICHMENT_COMPLETED: "Реестр и кредитная история проверены",
  ENRICHMENT_PARTIAL: "Кредитная история не найдена",
  SCORING_COMPLETED: "Скоринг завершён",
  DECISION_DRAFT: "Предварительное решение сформировано",
  ASSIGNED: "Назначен сотрудник",
  QUEUED_FOR_ADMIN: "Заявка в очереди администратора",
  INFO_REQUESTED: "Запрошены уточнения",
  INFO_REQUESTED_BY_EMPLOYEE: "Сотрудник запросил уточнения",
  CLIENT_RESPONDED: "Клиент ответил на запрос",
  FINAL_DECISION: "Финальное решение",
  OFFER_ACCEPTED: "Оферта принята",
  OFFER_DECLINED: "Оферта отклонена",
  SIGNED_DEMO: "Договор подписан",
  DISBURSED_DEMO: "Средства зачислены",
  DOCUMENT_UPLOADED: "Документ загружен",
  RISK_OVERRIDE: "Риск-исключение при одобрении",
  TECHNICAL_RETRY_REQUIRED: "Проверка приостановлена",
  REASSIGNMENT_REQUIRED: "Требуется переназначение",
  MANUALLY_ASSIGNED: "Назначение администратором",
  RESUBMITTED_DRAFT: "Повторная заявка"
};

export function eventTitle(event: Event): string {
  return EVENT_LABELS[event.event_type] ?? event.status_to ?? event.event_type;
}

export function Timeline({ events, compact = false }: { events: Event[]; compact?: boolean }) {
  if (!events.length) {
    return <p className="muted">События появятся после начала работы с заявкой.</p>;
  }
  const ordered = [...events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return (
    <ol className={`timeline ${compact ? "timeline-compact" : ""}`}>
      {ordered.map((event) => (
        <li key={event.id}>
          <span className="timeline-dot" />
          <div className="timeline-body">
            <div className="timeline-head">
              <strong>{eventTitle(event)}</strong>
              <time>{formatDateTime(event.created_at)}</time>
            </div>
            {event.comment && <p>{event.comment}</p>}
            <span className="timeline-actor">
              {event.actor_role === "system"
                ? "Автоматическая проверка"
                : event.actor_role === "client"
                  ? "Клиент"
                  : event.actor_role === "employee"
                    ? "Сотрудник банка"
                    : "Администратор"}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
  footer
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  // Портал обязателен: у page-stack есть transform-анимация, из-за которой
  // position: fixed считался бы относительно списка, а не окна браузера.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "danger" | "info";
}

const ToastContext = createContext<{ push: (message: string, tone?: ToastItem["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            {item.tone === "success" ? <CircleCheck size={18} /> : item.tone === "danger" ? <CircleAlert size={18} /> : <Info size={18} />}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast должен использоваться внутри ToastProvider");
  return context;
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
