import { useQuery } from "@tanstack/react-query";
import { Newspaper } from "lucide-react";
import { api } from "../api";
import { Badge, Button, Card, EmptyState, formatShortDate, LoadingBlock, PageHeader } from "../components/ui";
import type { ClientNewsFeed, ClientNewsItem } from "../types";

export function useNewsFeed() {
  return useQuery({ queryKey: ["client-news"], queryFn: api.client.news });
}

export function NewsList({ items }: { items: ClientNewsItem[] }) {
  return (
    <div className="news-list">
      {items.map((item) => (
        <article className="news-item" key={item.id}>
          <div className="news-head">
            <strong>{item.title}</strong>
            <time>{formatShortDate(item.published_at)}</time>
          </div>
          <p>{item.body}</p>
          <div className="news-reasons">
            {item.personal
              ? item.reasons.map((reason) => <Badge tone="info" key={reason}>{reason}</Badge>)
              : <Badge tone="neutral">Для всех клиентов</Badge>}
          </div>
        </article>
      ))}
    </div>
  );
}

function profileLine(profile: ClientNewsFeed["profile"]): string {
  const parts = [
    profile.opf,
    profile.okved && `ОКВЭД ${profile.okved}${profile.okved_name ? ` — ${profile.okved_name}` : ""}`,
    profile.age_months != null && `${Math.floor(profile.age_months / 12)} г. ${profile.age_months % 12} мес. с регистрации`,
    profile.products.length > 0 && `продукты: ${profile.products.join(", ")}`
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Профиль появится после проверки ИНН";
}

export default function NewsPage() {
  const query = useNewsFeed();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Новости"
        title="Лента для вашего бизнеса"
        description="Подборка зависит от вида деятельности, формы бизнеса, его возраста и статуса ваших заявок. У каждой новости указано, почему она в ленте."
      />
      {query.isLoading ? (
        <LoadingBlock />
      ) : query.isError ? (
        <Card><EmptyState title="Не удалось загрузить ленту" description="Повторите попытку позже." action={<Button onClick={() => query.refetch()}>Повторить</Button>} /></Card>
      ) : (
        <>
          <Card className="news-profile">
            <span className="muted">Ваш профиль для подборки</span>
            <strong>{profileLine(query.data!.profile)}</strong>
          </Card>
          {query.data!.items.length === 0 ? (
            <Card><EmptyState icon={<Newspaper size={26} />} title="Новостей пока нет" description="Загляните позже." /></Card>
          ) : (
            <Card><NewsList items={query.data!.items} /></Card>
          )}
        </>
      )}
    </div>
  );
}
