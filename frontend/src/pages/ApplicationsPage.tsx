import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileText, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import {
  Button,
  Card,
  EmptyState,
  formatMoney,
  formatShortDate,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusBadge,
  useToast,
  useDebouncedValue
} from "../components/ui";
import type { ApplicationSummary } from "../types";

const FILTERS = [
  { key: "all", label: "Все заявки" },
  { key: "active", label: "В работе" },
  { key: "completed", label: "Завершённые" },
  { key: "draft", label: "Черновики" }
];

export default function ApplicationsPage() {
  const [group, setGroup] = useState("all");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search.trim());
  const query = useQuery({
    queryKey: ["applications", group, searchQuery],
    queryFn: () => api.client.applications(group, searchQuery),
    placeholderData: keepPreviousData
  });
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [toDelete, setToDelete] = useState<ApplicationSummary | null>(null);
  const removal = useMutation({
    mutationFn: (id: number) => api.client.remove(id),
    onSuccess: () => {
      setToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["client-dashboard"] });
      push("Черновик удалён", "success");
    },
    onError: (err) => {
      setToDelete(null);
      push(err instanceof ApiError ? err.message : "Не удалось удалить черновик", "danger");
    }
  });

  return (
    <div className="page-stack">
      <PageHeader
        title="Мои заявки"
        description="Все заявки и черновики."
        actions={<Link className="btn btn-primary" to="/app/applications/new"><Plus size={17} /> Подать новую заявку</Link>}
      />
      <Card className="filter-card">
        <div className="tabs-row">
          {FILTERS.map((item) => (
            <button key={item.key} className={group === item.key ? "active" : ""} onClick={() => setGroup(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={17} />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по номеру или компании" />
        </div>
      </Card>

      {query.isLoading ? (
        <LoadingBlock variant="list" />
      ) : query.isError ? (
        <Card><EmptyState title="Не удалось загрузить заявки" description="Проверьте соединение и попробуйте ещё раз." action={<Button onClick={() => query.refetch()}>Повторить</Button>} /></Card>
      ) : query.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText size={26} />}
            title={searchQuery ? "Ничего не найдено" : "В этом разделе пока пусто"}
            description={searchQuery ? "Попробуйте изменить запрос." : "Создайте заявку — это займёт около десяти минут."}
            action={!searchQuery ? <Link className="btn btn-primary" to="/app/applications/new"><Plus size={16} /> Создать заявку</Link> : undefined}
          />
        </Card>
      ) : (
        <Card className="app-table">
          <div className="app-row app-row-head" aria-hidden="true">
            <span>Заявка</span><span>Сумма</span><span>Статус</span><span>Обновлено</span><span />
          </div>
          {query.data!.map((app) => {
            const href = app.status === "DRAFT" ? `/app/applications/new?draft=${app.id}` : `/app/applications/${app.id}`;
            const note = app.status === "NEED_INFO"
              ? "Банк ждёт ваш ответ"
              : app.assigned_employee ? app.assigned_employee.full_name : app.client_status;
            return (
              <div className={`app-row ${app.status === "NEED_INFO" ? "app-row-attention" : ""}`} key={app.id}>
                <div className="app-row-main">
                  <Link className="app-row-link" to={href}>{app.product.name}</Link>
                  <small>№ {app.number} · {app.purpose_label} · {app.term_months} мес.</small>
                </div>
                <div className="app-row-amount">
                  <strong>{formatMoney(app.approved_amount ?? app.amount)}</strong>
                  <small>{app.approved_amount ? `одобрено${app.approved_rate ? ` · ${app.approved_rate}%` : ""}` : `от ${app.product.rate.toFixed(1).replace(".", ",")}%`}</small>
                </div>
                <div className="app-row-status">
                  <StatusBadge status={app.status} />
                  <small className={app.status === "NEED_INFO" ? "warning-text" : ""}>{note}</small>
                </div>
                <time className="app-row-date">{formatShortDate(app.updated_at)}</time>
                <div className="app-row-actions">
                  {app.status === "DRAFT" && (
                    <button className="icon-button app-row-delete" onClick={() => setToDelete(app)} aria-label={`Удалить черновик № ${app.number}`} title="Удалить черновик"><Trash2 size={17} /></button>
                  )}
                  <ArrowRight size={17} className="app-row-arrow" aria-hidden="true" />
                </div>
              </div>
            );
          })}
        </Card>
      )}
      <Modal
        open={Boolean(toDelete)}
        title="Удалить черновик?"
        onClose={() => setToDelete(null)}
        footer={<><Button variant="ghost" onClick={() => setToDelete(null)}>Отмена</Button><Button variant="danger" loading={removal.isPending} onClick={() => toDelete && removal.mutate(toDelete.id)}>Удалить</Button></>}
      >
        <p>Черновик № {toDelete?.number} и приложенные файлы будут удалены без возможности восстановления.</p>
      </Modal>
    </div>
  );
}
