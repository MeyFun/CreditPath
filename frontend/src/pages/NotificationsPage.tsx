import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { Button, Card, EmptyState, formatDateTime, LoadingBlock, PageHeader, useToast } from "../components/ui";

export default function NotificationsPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { push } = useToast();
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

  return (
    <div className="page-stack">
      <PageHeader
        title="Уведомления"
        description="Статусы заявок и запросы банка."
        actions={<Button variant="secondary" icon={<CheckCheck size={17} />} loading={readAll.isPending} onClick={() => readAll.mutate()} disabled={!query.data?.unread}>Прочитать все</Button>}
      />
      {query.isLoading ? (
        <LoadingBlock />
      ) : query.data?.items.length === 0 ? (
        <Card><EmptyState icon={<Bell size={26} />} title="Уведомлений пока нет" description="Здесь появятся статусы заявок и запросы уточнений." /></Card>
      ) : (
        <div className="notification-list">
          {query.data?.items.map((item) => (
            <Card className={`notification-card ${item.is_read ? "" : "unread"} notification-${item.kind}`} key={item.id}>
              <span className="notif-dot" />
              <div className="notif-body">
                <div className="notif-head"><strong>{item.title}</strong><time>{formatDateTime(item.created_at)}</time></div>
                <p>{item.body}</p>
                <div className="notif-actions">
                  {item.application_id && <Link to={`${appPath}/${item.application_id}`} className="text-link">Открыть заявку <ExternalLink size={14} /></Link>}
                  {!item.is_read && <button className="text-button" onClick={() => readMutation.mutate(item.id)}>Отметить прочитанным</button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
