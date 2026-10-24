import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, RefreshCw, Search, UserCog, Users } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../api";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  formatDateTime,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  useToast
} from "../components/ui";
import type { User } from "../types";

const ROLE_LABELS: Record<string, string> = {
  client: "Клиент",
  employee: "Сотрудник банка",
  admin: "Администратор"
};

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [target, setTarget] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", full_name: "", password: "", role: "client", company_inn: "" });
  const [createError, setCreateError] = useState("");
  const queryClient = useQueryClient();
  const { push } = useToast();
  const query = useQuery({ queryKey: ["admin-users", search, role], queryFn: () => api.admin.users(search, role) });
  const mutation = useMutation({
    mutationFn: ({ user, nextRole }: { user: User; nextRole: "client" | "employee" }) => api.admin.changeRole(user.id, nextRole),
    onSuccess: (updated) => {
      push(`Роль пользователя @${updated.username} изменена`, "success");
      setTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось изменить роль")
  });

  const create = useMutation({
    mutationFn: () => api.admin.createUser({ ...form, company_inn: form.company_inn.trim() || undefined }),
    onSuccess: (created) => {
      push(`Пользователь @${created.username} создан`, "success");
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (err) => setCreateError(err instanceof ApiError ? (err.details?.map((item) => item.message).join("; ") || err.message) : "Не удалось создать пользователя")
  });

  function openCreate() {
    setForm({ username: "", full_name: "", password: "", role: "client", company_inn: "" });
    setCreateError("");
    setCreating(true);
  }

  function openChange(user: User) {
    setError("");
    setTarget(user);
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Пользователи и роли"
        description="Банк заводит клиентов и сотрудников и выдаёт роли. ИНН в профиле клиента подтверждает его право подавать заявки от этой компании."
        actions={<Button icon={<Plus size={16} />} onClick={openCreate}>Новый пользователь</Button>}
      />
      <Card className="filter-card">
        <div className="queue-filters">
          <div className="search-box"><Search size={17} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя, логин или ИНН" /></div>
          <select className="input compact-select" value={role} onChange={(event) => setRole(event.target.value)} aria-label="Фильтр по роли">
            <option value="">Все роли</option>
            <option value="client">Клиенты</option>
            <option value="employee">Сотрудники</option>
            <option value="admin">Администраторы</option>
          </select>
          <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => query.refetch()}>Обновить</Button>
        </div>
        <span className="muted small">Найдено: {query.data?.length ?? 0}</span>
      </Card>
      {query.isLoading ? (
        <LoadingBlock variant="list" />
      ) : query.isError ? (
        <ErrorState title="Не удалось загрузить пользователей" onRetry={() => query.refetch()} />
      ) : query.data?.length === 0 ? (
        <Card><EmptyState icon={<Users size={26} />} title="Пользователи не найдены" description="Измените параметры поиска." /></Card>
      ) : (
        <Card className="table-card">
          <div className="table-wrap">
            <table className="data-table stack-table admin-users-table">
              <thead><tr><th>Пользователь</th><th>Логин</th><th>Компания / ИНН</th><th>Роль</th><th>Последний вход</th><th>Действие</th></tr></thead>
              <tbody>
                {query.data?.map((user) => (
                  <tr key={user.id}>
                    <td className="cell-lead"><div className="table-primary"><span className="avatar avatar-small">{user.full_name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><div><strong>{user.full_name}</strong><small>{user.is_active ? "Активен" : "Заблокирован"}</small></div></div></td>
                    <td data-label="Логин">@{user.username}</td>
                    <td data-label="Компания / ИНН">{user.company_inn ? `ИНН ${user.company_inn}` : <span className="muted">—</span>}</td>
                    <td data-label="Роль"><Badge tone={user.role === "admin" ? "neutral" : user.role === "employee" ? "info" : "success"}>{ROLE_LABELS[user.role]}</Badge></td>
                    <td data-label="Последний вход">{user.last_login_at ? formatDateTime(user.last_login_at) : "—"}</td>
                    <td className="cell-lead">
                      {user.role === "admin" ? (
                        <span className="muted small">—</span>
                      ) : (
                        <button className="text-link" onClick={() => openChange(user)}><UserCog size={15} /> Сменить роль</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={Boolean(target)}
        title="Подтверждение изменения роли"
        onClose={() => setTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>Отмена</Button>
            <Button
              loading={mutation.isPending}
              onClick={() => target && mutation.mutate({ user: target, nextRole: target.role === "employee" ? "client" : "employee" })}
            >
              Подтвердить изменение
            </Button>
          </>
        }
      >
        {target && (
          <div className="role-change">
            <div className="role-change-user"><span className="avatar">{target.full_name.slice(0, 2)}</span><div><strong>{target.full_name}</strong><p>@{target.username}</p></div></div>
            <div className="role-change-flow">
              <Badge tone="neutral">{ROLE_LABELS[target.role]}</Badge>
              <ArrowRight size={18} />
              <Badge tone="info">{ROLE_LABELS[target.role === "employee" ? "client" : "employee"]}</Badge>
            </div>
            <Alert tone="warning" title="Действие попадёт в аудит">
              Смена роли будет зафиксирована: кто, когда, было/стало. При переводе сотрудника в клиенты его активные заявки вернутся в очередь администратора.
            </Alert>
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        )}
      </Modal>
      <Modal
        open={creating}
        title="Новый пользователь"
        onClose={() => setCreating(false)}
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Отмена</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Создать</Button></>}
      >
        <div className="modal-form">
          <Field label="Роль"><select className="input" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, company_inn: event.target.value === "client" ? form.company_inn : "" })}><option value="client">Клиент</option><option value="employee">Сотрудник банка</option></select></Field>
          <Field label="ФИО" hint="Для клиента сверяется с руководителем и учредителями по реестру."><Input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></Field>
          <Field label="Логин" hint="3–32 символа: латиница, цифры, точка, дефис."><Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="off" /></Field>
          <Field label="Временный пароль" hint="Не короче 8 символов, буквы и цифры."><Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" /></Field>
          {form.role === "client" && (
            <Field label="ИНН компании" hint="Закрепляет компанию за клиентом: по ней заявка подаётся без доверенности. Проверяется по реестру."><Input value={form.company_inn} inputMode="numeric" maxLength={12} onChange={(event) => setForm({ ...form, company_inn: event.target.value.replace(/D/g, "") })} placeholder="10 или 12 цифр" /></Field>
          )}
          {createError && <Alert tone="danger">{createError}</Alert>}
        </div>
      </Modal>
    </div>
  );
}
