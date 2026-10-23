import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileText, Plus, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import {
  applicationProgress,
  Button,
  Card,
  EmptyState,
  formatDate,
  formatMoney,
  formatShortDate,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  ProgressBar,
  StatusBadge,
  useToast
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
  // Отложенное значение: список не мигает лоадером на каждую букву поиска.
  const deferredSearch = useDeferredValue(search.trim());
  const query = useQuery({
    queryKey: ["applications", group, deferredSearch],
    queryFn: () => api.client.applications(group, deferredSearch),
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
        <LoadingBlock />
      ) : query.isError ? (
        <Card><EmptyState title="Не удалось загрузить заявки" description="Проверьте соединение и попробуйте ещё раз." action={<Button onClick={() => query.refetch()}>Повторить</Button>} /></Card>
      ) : query.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText size={26} />}
            title={deferredSearch ? "Ничего не найдено" : "В этом разделе пока пусто"}
            description={deferredSearch ? "Попробуйте изменить запрос." : "Создайте заявку — это займёт около десяти минут."}
            action={!deferredSearch ? <Link className="btn btn-primary" to="/app/applications/new"><Plus size={16} /> Создать заявку</Link> : undefined}
          />
        </Card>
      ) : (
        <div className="application-list">
          {query.data!.map((app) => (
            <Card className="application-card" key={app.id}>
              <div className="app-card-main">
                <div className="app-card-top">
                  <span className="file-badge"><FileText size={18} /></span>
                  <span className="app-number">№ {app.number}</span>
                  <StatusBadge status={app.status} />
                  <span className="app-date">{formatShortDate(app.submitted_at ?? app.created_at)}</span>
                </div>
                <div className="app-card-body">
                  <div>
                    <h3>{app.product.name}</h3>
                    <p>{app.purpose_label} · {app.term_months} мес. · ставка от {app.product.rate.toFixed(1).replace(".", ",")}%</p>
                    {app.status === "NEED_INFO" && <p className="warning-text">Требуется ответ на запрос уточнений</p>}
                    {app.status === "REJECTED" && <p className="muted">Решение принято. Причина доступна в карточке заявки.</p>}
                  </div>
                  <div className="app-amount">
                    <span>{app.approved_amount ? "Одобренная сумма" : "Запрошенная сумма"}</span>
                    <strong>{formatMoney(app.approved_amount ?? app.amount)}</strong>
                    {app.approved_term_months && <small>{app.approved_term_months} мес. · {app.approved_rate}%</small>}
                  </div>
                </div>
                <div className="app-card-progress">
                  <ProgressBar value={applicationProgress(app.status)} />
                  <span>{app.assigned_employee ? `Сотрудник: ${app.assigned_employee.full_name}` : app.client_status}</span>
                </div>
              </div>
              <div className="app-card-side">
                <div>
                  <span className="muted small">Обновлено</span>
                  <strong>{formatDate(app.updated_at)}</strong>
                </div>
                {app.status === "DRAFT" ? (
                  <div className="app-card-actions">
                    <button className="icon-button" onClick={() => setToDelete(app)} aria-label={`Удалить черновик № ${app.number}`} title="Удалить черновик"><Trash2 size={17} /></button>
                    <Link className="btn btn-primary btn-sm" to={`/app/applications/new?draft=${app.id}`}>Продолжить <ArrowRight size={15} /></Link>
                  </div>
                ) : (
                  <Link className="btn btn-secondary btn-sm" to={`/app/applications/${app.id}`}>Открыть заявку <ArrowRight size={15} /></Link>
                )}
              </div>
            </Card>
          ))}
        </div>
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
