-- 開発用シードデータ(ローカル D1 専用)
-- 適用: pnpm exec wrangler d1 execute yorox-db --local --file=./seed/dev-seed.sql

-- ユーザー alice(ローカル)
INSERT OR IGNORE INTO actors (id, kind, state, handle, domain, uri, display_name, created_at, updated_at)
VALUES ('01J0000000000000000000USER', 'user', 'local', NULL, NULL,
        'http://localhost:8799/users/01J0000000000000000000USER', 'Alice',
        1754000000000, 1754000000000);
INSERT OR IGNORE INTO users (actor_id, email, created_at)
VALUES ('01J0000000000000000000USER', 'alice@example.com', 1754000000000);

-- グループ kyoto-tech
INSERT OR IGNORE INTO actors (id, kind, state, handle, domain, uri, inbox_url, display_name, summary, created_at, updated_at)
VALUES ('01J000000000000000000GROUP', 'group', 'local', 'kyoto-tech', NULL,
        'http://localhost:8799/groups/01J000000000000000000GROUP',
        'http://localhost:8799/groups/01J000000000000000000GROUP/inbox',
        'Kyoto Tech Meetup', '京都の技術コミュニティ(開発用シード)',
        1754000000000, 1754000000000);
INSERT OR IGNORE INTO groups (actor_id, is_personal, description_md, created_at)
VALUES ('01J000000000000000000GROUP', 0, '京都の技術コミュニティ(開発用シード)', 1754000000000);

-- プリセットロールとオーナー
INSERT OR IGNORE INTO group_roles (id, group_actor_id, name, permissions, is_preset, created_at)
VALUES ('01J00000000000000000ROLE01', '01J000000000000000000GROUP', 'オーナー',
        '["event.create","event.edit","attendance.manage","lottery.run","member.manage","group.settings"]', 1, 1754000000000);
INSERT OR IGNORE INTO group_members (group_actor_id, member_actor_id, role_id, created_at)
VALUES ('01J000000000000000000GROUP', '01J0000000000000000000USER', '01J00000000000000000ROLE01', 1754000000000);

-- 公開イベント(2026-09-01 19:00 JST = 1787911200000)
INSERT OR IGNORE INTO events (id, group_actor_id, title, description_md, starts_at, ends_at, timezone,
                    venue_name, visibility, participant_list_public, published_at,
                    created_by_actor_id, created_at, updated_at)
VALUES ('01J00000000000000000EVENT1', '01J000000000000000000GROUP',
        'Yorox 開発ミートアップ #1', 'Yorox の開発について語る会です。

- 進捗共有
- 設計議論',
        1787911200000, 1787918400000, 'Asia/Tokyo',
        '京都リサーチパーク', 'public', 1, 1754000000000,
        '01J0000000000000000000USER', 1754000000000, 1754000000000);

-- 参加枠: 先着(一般)+ 抽選(LT)
INSERT OR IGNORE INTO slots (id, event_id, name, capacity, method, waitlist_model, promotion_policy, sort_order, created_at)
VALUES ('01J00000000000000000SLOT01', '01J00000000000000000EVENT1', '一般参加', 30, 'fcfs', 'connpass', 'auto', 0, 1754000000000);
INSERT OR IGNORE INTO slots (id, event_id, name, capacity, method, waitlist_model, promotion_policy, lottery_logic, lottery_at, sort_order, created_at)
VALUES ('01J00000000000000000SLOT02', '01J00000000000000000EVENT1', 'LT枠', 5, 'lottery', 'connpass', 'auto', 'random', 1787824800000, 1, 1754000000000);

-- セッション
INSERT OR IGNORE INTO event_sessions (id, event_id, title, description_md, speaker_name, sort_order)
VALUES ('01J000000000000000000SESS1', '01J00000000000000000EVENT1', 'Yorox のアーキテクチャ', 'Cloudflare Workers + Waku + D1 の構成について', 'Alice', 0);

-- 資料
INSERT OR IGNORE INTO materials (id, event_id, session_id, title, url, created_by_actor_id, created_at)
VALUES ('01J0000000000000000000MAT1', '01J00000000000000000EVENT1', '01J000000000000000000SESS1',
        'アーキテクチャ資料', 'https://example.com/slides', '01J0000000000000000000USER', 1754000000000);
