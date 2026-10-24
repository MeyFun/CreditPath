import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, BellRing, Check, CheckCheck, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, useToast } from "../components/ui";
import type { NotificationItem } from "../types";

/** Тип уведомления задаёт иконку и цвет: действие от клиента — красный акцент, результат — зелёный. */
const KIND: Record<string, { icon: LucideIcon; label: string }> = {
  action: { icon: BellRing, label: "Нужно действие" },
  warning: { icon: TriangleAlert, label: "Внимание" },
  danger: { icon: CircleAlert, label: "Отказ" },
  success: { icon: CircleCheck, label: "Готово" },
  info: { icon: Info, label: "Статус" }
};

function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Сегодня";
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/** Лента по дням: заголовок «Сегодня / Вчера / дата» и уведомления этого дня под ним. */
function groupByDay(items: NotificationItem[]): [string, NotificationItem[]][] {
  const groups = new Map<string, NotificationItem[]>();
  items.forEach((item) => {
    const key = dayLabel(item.created_at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups.entries()];
}

export default function NotificationsPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const query = useQuery({ queryKey: ["notifications"], queryFn: api.notifications.list });
  const readMutation = useMutation({
    mutationFn: api.notifications.read,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });
  const readAll = useMutation({
    mutationFn: api.notifications.readAll,
    onSuccess: () => {
      push("Все уведомления отмечены прочитанными", "success");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });

  const appPath = location.pathname.startsWith("/staff")
    ? "/staff/applications"
    : location.pathname.startsWith("/admin")
      ? "/admin/applications"
      : "/app/applications";
  const unread = query.data?.unread ?? 0;
  const items = (query.data?.items ?? []).filter((item) => !onlyUnread || !item.is_read);

  return (
    <div className="page-stack">
      <PageHeader
        title="Уведомления"
        description={unread ? `${unread} непрочитанных · статусы заявок и запросы банка` : "Статусы заявок и запросы банка"}
        actions={<Button variant="secondary" icon={<CheckCheck size={17} />} loading={readAll.isPending} onClick={() => readAll.mutate()} disabled={!unread}>Прочитать все</Button>}
      />
      <div className="tabs-row notif-filter" role="tablist">
        <button role="tab" aria-selected={!onlyUnread} className={!onlyUnread ? "active" : ""} onClick={() => setOnlyUnread(false)}>Все</button>
        <button role="tab" aria-selected={onlyUnread} className={onlyUnread ? "active" : ""} onClick={() => setOnlyUnread(true)}>
          Непрочитанные {unread > 0 && <span className="notif-count">{unread}</span>}
        </button>
      </div>
      {query.isLoading ? (
        <LoadingBlock variant="list" />
      ) : query.isError ? (
        <ErrorState title="Не удалось загрузить уведомления" onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bell size={26} />}
            title={onlyUnread ? "Всё прочитано" : "Уведомлений пока нет"}
            description={onlyUnread ? "Новые статусы и запросы банка появятся здесь." : "Здесь появятся статусы заявок и запросы уточнений."}
          />
        </Card>
      ) : (
        <div className="notif-feed">
          {groupByDay(items).map(([day, dayItems]) => (
            <section className="notif-day" key={day}>
              <h2 className="notif-day-title">{day}</h2>
              <div className="notif-group">
                {dayItems.map((item) => {
                  const kind = KIND[item.kind] ?? KIND.info;
                  const Icon = kind.icon;
                  return (
                    <article className={`notif-item notif-${item.kind} ${item.is_read ? "" : "unread"}`} key={item.id}>
                      <span className="notif-icon" aria-hidden="true"><Icon size={18} strokeWidth={2.2} /></span>
                      <div className="notif-main">
                        <div className="notif-head">
                          <strong>{item.title}</strong>
                          <time dateTime={item.created_at}>{timeLabel(item.created_at)}</time>
                        </div>
                        <p>{item.body}</p>
                        <div className="notif-actions">
                          {item.kind !== "info" && <span className="notif-kind">{kind.label}</span>}
                          {item.application_id && (
                            <Link
                              to={`${appPath}/${item.application_id}`}
                              className="notif-open"
                              onClick={() => !item.is_read && readMutation.mutate(item.id)}
                            >
                              Открыть заявку <ArrowRight size={14} />
                            </Link>
                          )}
                          {!item.is_read && (
                            <button className="notif-read" onClick={() => readMutation.mutate(item.id)}>
                              <Check size={15} /> Прочитано
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
