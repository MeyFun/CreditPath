import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, Hash, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import {
  Alert,
  Badge,
  Button,
  Card,
  formatDateTime,
  LoadingBlock,
  Modal,
  PageHeader,
  useToast
} from "../components/ui";
import type { AuditItem } from "../types";

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Вход в систему",
  "auth.registered": "Регистрация",
  "user.role_changed": "Смена роли",
  "user.profile_updated": "Профиль обновлён",
  "application.created": "Создана заявка",
  "application.updated": "Заявка обновлена",
  "application.submitted": "Заявка отправлена",
  "application.status_changed": "Смена статуса",
  "application.assigned": "Назначен сотрудник",
  "application.manually_assigned": "Назначение администратором",
  "application.decision": "Кредитное решение",
  "application.risk_override": "Риск-исключение при одобрении",
  "application.need_info": "Запрос уточнений",
  "application.info_provided": "Ответ клиента",
  "application.resubmitted": "Повторная подача",
  "offer.accepted": "Оферта принята",
  "offer.declined": "Оферта отклонена",
  "contract.signed_demo": "Демо-подписание",
  "funds.disbursed_demo": "Демо-зачисление",
  "document.uploaded": "Документ загружен",
  "product.updated": "Продукт изменён",
  "scoring_config.updated": "Скоринг обновлён",
  "application.queued_for_admin": "Очередь администратора"
};

export default function AdminAudit() {
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AuditItem | null>(null);
  const { push } = useToast();
  const limit = 50;
  const query = useQuery({
    queryKey: ["admin-audit", action, offset],
    queryFn: () => api.admin.audit({ action, offset, limit })
  });
  const verify = useMutation({
    mutationFn: api.admin.verifyAudit,
    onSuccess: (result) => push(result.message, result.valid ? "success" : "danger")
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Безопасность и соответствие"
        title="Журнал аудита"
        description="Записи нельзя изменить или удалить."
        actions={<Button icon={<ShieldCheck size={17} />} loading={verify.isPending} onClick={() => verify.mutate()}>Проверить целостность</Button>}
      />
      <div className="audit-summary">
        <Card className="audit-integrity">
          <span className="audit-shield"><ShieldCheck size={25} /></span>
          <div><span className="eyebrow">Неизменяемый журнал</span><h2>Append-only + SHA-256</h2><p>Каждая запись содержит хеш предыдущей. Проверка доступна только администратору.</p></div>
          <Badge tone="success">Защищено</Badge>
        </Card>
        <Card className="audit-warning">
          <ShieldAlert size={22} />
          <div><strong>Никто не может изменить журнал</strong><p>Даже администратор. Триггер PostgreSQL отклоняет UPDATE и DELETE.</p></div>
        </Card>
      </div>
      {verify.data && <Alert tone={verify.data.valid ? "success" : "danger"} title={verify.data.valid ? "Цепочка целостна" : "Обнаружено нарушение"}>{verify.data.message}{verify.data.broken_at ? ` · запись #${verify.data.broken_at}` : ""}</Alert>}

      <Card className="filter-card">
        <div className="queue-filters">
          <select className="input compact-select" value={action} onChange={(event) => { setAction(event.target.value); setOffset(0); }} aria-label="Тип действия">
            <option value="">Все действия</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => query.refetch()}>Обновить</Button>
        </div>
        <span className="muted small">Показано {query.data?.length ?? 0} записей</span>
      </Card>

      {query.isLoading ? (
        <LoadingBlock />
      ) : (
        <Card className="table-card">
          <div className="table-wrap">
            <table className="data-table audit-table">
              <thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Объект</th><th>Было → стало</th><th>Хеш</th></tr></thead>
              <tbody>
                {query.data?.map((entry) => (
                  <tr key={entry.id} onClick={() => setSelected(entry)} className="clickable-row">
                    <td><span className="mono">{formatDateTime(entry.created_at)}</span></td>
                    <td><strong>{entry.actor_label}</strong><small className="block muted">ID {entry.actor_id ?? "system"}</small></td>
                    <td><Badge tone={entry.action.includes("risk_override") ? "danger" : entry.action.includes("decision") ? "info" : entry.action.includes("role") ? "warning" : "neutral"}>{ACTION_LABELS[entry.action] ?? entry.action}</Badge></td>
                    <td>{entry.entity_type} {entry.entity_id ? `#${entry.entity_id}` : ""}</td>
                    <td><span className="audit-change">{summarize(entry.before)} → {summarize(entry.after)}</span></td>
                    <td><span className="hash"><Hash size={13} /> {entry.entry_hash.slice(0, 10)}…</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="pagination">
        <Button variant="secondary" className="btn-sm" icon={<ChevronLeft size={16} />} disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - limit))}>Назад</Button>
        <span>Записи {offset + 1}–{offset + (query.data?.length ?? 0)}</span>
        <Button variant="secondary" className="btn-sm" disabled={(query.data?.length ?? 0) < limit} onClick={() => setOffset((value) => value + limit)}>Далее <ChevronRight size={16} /></Button>
      </div>

      <Modal open={Boolean(selected)} title={`Запись аудита #${selected?.id ?? ""}`} onClose={() => setSelected(null)}>
        {selected && (
          <div className="audit-detail">
            <div className="summary-lines">
              <div><span>Время</span><strong>{formatDateTime(selected.created_at)}</strong></div>
              <div><span>Пользователь</span><strong>{selected.actor_label}</strong></div>
              <div><span>Действие</span><strong>{ACTION_LABELS[selected.action] ?? selected.action}</strong></div>
              <div><span>Объект</span><strong>{selected.entity_type} #{selected.entity_id}</strong></div>
            </div>
            <div className="json-block"><span>Было</span><pre>{JSON.stringify(selected.before, null, 2) || "—"}</pre></div>
            <div className="json-block"><span>Стало</span><pre>{JSON.stringify(selected.after, null, 2) || "—"}</pre></div>
            <div className="hash-chain">
              <div><span>Предыдущий хеш</span><code>{selected.previous_hash}</code></div>
              <div><span>Хеш записи</span><code>{selected.entry_hash}</code></div>
            </div>
            <Alert tone="info"><CheckCircle2 size={15} /> Запись доступна только для чтения.</Alert>
          </div>
        )}
      </Modal>
    </div>
  );
}

function summarize(value: Record<string, unknown> | null): string {
  if (!value) return "—";
  const keys = Object.keys(value);
  if (!keys.length) return "—";
  return keys.slice(0, 2).map((key) => `${key}: ${String(value[key]).slice(0, 28)}`).join(", ");
}
