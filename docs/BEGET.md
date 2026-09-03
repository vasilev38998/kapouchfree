# Развёртывание на обычном виртуальном хостинге Beget

Проект проектируется так, чтобы не требовать VPS на старте.

Beget официально поддерживает запуск Node.js-приложений на виртуальном хостинге через Apache `mod_passenger`. Для production приложение должно запускаться Passenger-ом, а не вручную через постоянно открытый SSH-сеанс.

## Почему realtime сделан через polling

На виртуальном хостинге мы не делаем WebSocket обязательной частью архитектуры. Постоянные соединения хуже сочетаются с shared hosting и процессной моделью Passenger. Поэтому уведомления и новые сообщения получают события по cursor-based polling. Для пользователя обновления приходят почти сразу, при этом приложение остаётся совместимо с обычным тарифом Beget.

## База данных

Для production используем MySQL, доступный на виртуальном хостинге Beget:

- users / profiles;
- sessions;
- posts / comments / reactions;
- follows;
- conversations / messages;
- notifications / events.

OTP-коды и текущие in-memory sessions в следующих этапах также будут вынесены из памяти процесса. На shared hosting это обязательно, поскольку Passenger может держать несколько процессов и перезапускать их.

## Passenger

Фактические абсолютные пути зависят от логина Beget, поэтому `.htaccess` не коммитится с выдуманными путями. На хостинге нужно указать:

```apache
PassengerNodejs /home/LOGIN/.local/bin/node
PassengerAppRoot /home/LOGIN/PATH_TO_PROJECT
PassengerAppType node
PassengerStartupFile server/index.js
```

Точные пути нужно получить командами `which node` и `realpath` в Docker-окружении аккаунта Beget.

После изменения серверного кода Passenger-приложение перезапускается через `tmp/restart.txt` согласно инструкции Beget.

## Масштабирование

Начальная схема: Beget virtual hosting + Node.js Passenger + MySQL + adaptive polling.

Если аудитория вырастет настолько, что polling создаст избыточную нагрузку, транспорт событий можно вынести в отдельный realtime-сервис или WebSocket-инфраструктуру. API и бизнес-модель событий уже отделены от транспорта, поэтому переписывать соцсеть целиком не потребуется.
