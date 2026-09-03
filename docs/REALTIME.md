# Realtime architecture

## Goal

Все действия пользователей должны превращаться в события: новые сообщения, комментарии, реакции, подписки, упоминания, новые посты в подписках, изменения профиля/сообщества и системные уведомления.

## Shared-hosting friendly transport

Основной транспорт для виртуального хостинга Beget — adaptive polling:

- активная вкладка: запрос новых событий примерно раз в 2 секунды;
- фоновая вкладка: примерно раз в 10 секунд;
- после собственного действия пользователя клиент может запрашивать события сразу;
- клиент передаёт `cursor`, сервер возвращает только события новее него;
- endpoint: `GET /api/realtime/events?cursor=N`.

Это не требует постоянно открытых WebSocket/SSE-соединений и поэтому подходит для обычного shared hosting/Passenger. Если позже потребуется гарантированная субсекундная доставка при большой аудитории, слой транспорта можно заменить на WebSocket/внешний realtime-сервис без изменения модели событий.

## Event types

Планируемые типы:

- `message.created`
- `message.read`
- `comment.created`
- `reaction.created`
- `follow.created`
- `mention.created`
- `post.created`
- `community.invite`
- `community.role_changed`
- `notification.system`

Каждое событие имеет последовательный `id`, уникальный `eventId`, тип, получателя, автора, payload и время создания.

## Persistence

Текущий event buffer находится в памяти только для прототипа. При подключении MySQL событие должно записываться в таблицу `events` в той же бизнес-транзакции, что и основное действие. Это позволит нескольким процессам Passenger видеть одинаковый поток событий и не терять уведомления при рестарте.

Рекомендуемая таблица:

```sql
CREATE TABLE events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_uuid CHAR(36) NOT NULL UNIQUE,
  type VARCHAR(80) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  recipient_user_id BIGINT UNSIGNED NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_recipient_cursor (recipient_user_id, id),
  INDEX idx_created_at (created_at)
);
```

Для личных сообщений будет отдельная таблица сообщений; event содержит только данные, необходимые для мгновенного обновления UI.
