# NaMaMeMo 引き継ぎドキュメント

**ver.1.02** ― アウトラインプロセッサ型メモ PWA  
招待制・上限50人の個人向けクローズドアプリ。

---

## 1. ローカルファイル構成

```
C:\Users\nama1\Desktop\出力ファイル\FFFTP\MeMo\
├── .env                            ← 環境変数（Git未管理・下記参照）
├── package.json
├── vite.config.js
├── index.html
├── HANDOFF.md                      ← このファイル
├── public/                         ← PWAアイコン等の静的アセット
├── supabase/
│   └── functions/
│       └── refresh-drive-token/
│           └── index.ts            ← Supabase Edge Function（Deno）
└── src/
    ├── App.jsx                     ★ メインコンポーネント（最重要・最大）
    ├── main.jsx
    ├── supabaseClient.js           ← Supabaseクライアント初期化
    ├── App.css / index.css
    ├── sw.js                       ← Service Worker
    ├── assets/
    ├── components/
    │   ├── Auth.jsx                ← ログイン画面（ニックネーム入力含む）
    │   ├── AdminModal.jsx          ← 管理者パネル（admin限定）
    │   ├── SettingsModal.jsx       ← 設定モーダル（一般・表示・編集機能・バックアップ の4タブ）
    │   ├── RichEditor.jsx          ★ TipTapエディタ（最大のコンポーネント）
    │   ├── TreePane.jsx            ← ノードツリー（左/右/上/下配置に対応）
    │   ├── TreeNode.jsx            ← ツリーの1ノード
    │   ├── EditorPane.jsx          ← エディタペイン
    │   ├── CategoryBar.jsx         ← カテゴリ切り替えバー
    │   ├── ShareModal.jsx          ← Web公開モーダル
    │   ├── ChangelogModal.jsx      ← 更新履歴（VERSION定数あり）
    │   ├── DriveMigrationBar.jsx   ← Google Drive移行バー
    │   ├── PublicViewer.jsx        ← 公開ページ（URLパラメータ ?p=ID で表示）
    │   ├── ReminderModal.jsx       ← リマインダー設定
    │   ├── InstallBanner.jsx       ← PWAインストール促進バナー
    │   ├── OfflineBanner.jsx
    │   ├── PWAUpdateModal.jsx
    │   ├── SearchAndStyleBar.jsx
    │   └── FlickButton.jsx
    ├── hooks/
    │   ├── useNodes.js             ★ ノードCRUD・オフライン対応
    │   ├── useCategories.js        ← カテゴリCRUD・オフラインキャッシュ
    │   ├── useSettings.js          ← localStorage設定（MAX_* 定数もここ）
    │   ├── useBackup.js            ← 自動バックアップ
    │   ├── useDriveMigration.js    ← Google Drive移行処理
    │   ├── useOnlineStatus.js      ← online/offline イベント検知
    │   ├── useOfflineQueue.js
    │   ├── useReminder.js
    │   └── usePWA.js
    └── utils/
        ├── driveToken.js           ★ Driveトークン取得（3段階フォールバック）
        └── offlineDB.js            ← IndexedDB キャッシュ・ダーティキュー
```

---

## 2. デプロイ情報

| 項目 | 内容 |
|------|------|
| 公開URL | `https://nama1223.github.io/NaMaMeMo/` |
| リポジトリ | GitHub: `nama1223/NaMaMeMo`（gh-pages ブランチに自動デプロイ） |
| デプロイコマンド | `npm run deploy`（build → gh-pages -d dist を実行） |
| ローカル開発 | `npm run dev` |
| ビルドツール | Vite + @vitejs/plugin-react + vite-plugin-pwa |

### 環境変数（`.env` ファイル・Git未管理）

```env
VITE_SUPABASE_URL=https://smyvnwvtnxhpocyqudjo.supabase.co
VITE_SUPABASE_ANON_KEY=（Supabaseダッシュボード → Settings → API → anon public）
VITE_ADMIN_EMAILS=管理者メールアドレス（カンマ区切り複数可）
```

### Edge Function 用シークレット

Supabase Dashboard → Edge Functions → Secrets に設定済み：

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

---

## 3. 外部サービス一覧

### 3-1. Supabase（バックエンド全般）

**プロジェクトID**: `smyvnwvtnxhpocyqudjo`  
Dashboard: `https://supabase.com/dashboard/project/smyvnwvtnxhpocyqudjo`

#### データベーステーブル

| テーブル | 主なカラム | RLS |
|---------|-----------|-----|
| `nodes` | id, user_id, category_id, parent_id, title, content, position, is_expanded, title_style, is_public | ✅ user_id = auth.uid() |
| `categories` | id, user_id, name, position | ✅ 同上 |
| `node_backups` | id, user_id, node_id, title, content, backed_up_at | ✅ 同上 |

#### ストレージ

| バケット | 用途 |
|---------|------|
| `images` | 画像・音声添付ファイル。パス: `{user_id}/{filename}` |

#### RPC関数（SQL Editor で定義・SECURITY DEFINER）

| 関数名 | 説明 |
|--------|------|
| `get_user_count()` | 全ユーザー数を返す（ログイン上限チェック用） |
| `get_all_users_summary()` | 管理者パネル用。nickname, categories, node_count, db_bytes を返す |

RPC関数の返り値の型を変更する場合は、`CREATE OR REPLACE` では型変更不可のため先に `DROP` が必要：

```sql
DROP FUNCTION IF EXISTS 関数名();
CREATE OR REPLACE FUNCTION ...
```

#### Edge Function

| 関数名 | 説明 |
|--------|------|
| `refresh-drive-token` | サーバーサイドで Google OAuth refresh_token → access_token を自動更新。POST リクエストに Supabase JWT が必要 |

Edge Function のデプロイ:

```bash
supabase functions deploy refresh-drive-token
```

### 3-2. Google OAuth / Google Drive API

- **目的①**: Supabase Auth 経由の Google ログイン
- **目的②**: Google Drive API（`drive.file` スコープ）でユーザーのDriveに画像・ファイルを保存
- **Google Cloud Console**: OAuth クライアントID/シークレットを管理
- **公開設定**: 「公開」モード（テストモード解除済み）。Googleによる審査（検証）は未実施だが不要
- **ログイン処理**: `supabase.auth.signInWithOAuth({ provider: 'google', options: { scopes: 'drive.file', access_type: 'offline' } })`

### 3-3. GitHub Pages

静的ホスティング。`gh-pages` npm パッケージで `dist/` を `gh-pages` ブランチに自動デプロイ。  
PWA（Service Worker あり）のため、デプロイ後の反映が遅れることがある。

---

## 4. アーキテクチャ・設計の要点

### 認証フロー

```
1. Auth.jsx でニックネーム入力 → sessionStorage に一時保存
2. signInWithOAuth → Google認証画面 → アプリURLにリダイレクトバック
3. onAuthStateChange(SIGNED_IN) が発火
   → 必ず setTimeout(async () => { ... }, 0) で非同期処理を外に出す
     （コールバック内で await するとSupabase内部ロックのデッドロックが起きる）
   → provider_refresh_token を settings に保存
   → checkNewUserLimit() でユーザー上限チェック
   → setSession() → アプリ表示
   → supabase.auth.updateUser({ nickname }) をバックグラウンドで実行（ブロックしない）
```

### 設定の保存場所

| データ | 保存場所 |
|--------|---------|
| テーマ・フォントサイズ等の設定 | `localStorage['namamemo_settings']`（JSON） |
| 最後に選択したカテゴリID | `localStorage['namamemo_category_{userId}']` |
| ニックネーム | `localStorage['namamemo_settings'].nickname` + `auth.users.raw_user_meta_data.nickname` の両方 |
| Drive refresh_token | `localStorage['namamemo_settings'].googleProviderRefreshToken` |

**重要**: `updateSettings(patch)` はプレーンオブジェクトのみ受け付ける（関数渡し不可）。

### Google Drive トークンの仕組み（`driveToken.js`）

4段階フォールバック：

1. **モジュールレベルキャッシュ**（55分間有効）
2. **Supabase Edge Function**（`refresh-drive-token`）でサーバーサイド更新
3. **GIS stored token**（localStorage の `googleDriveToken` が有効期限内なら使用）
4. 全部失敗 → カスタムイベント `refresh-drive-token` を dispatch → App.jsx が「Drive再接続」バナーを表示

**オフライン時**: キャッシュ済みトークンを返す。なければ `null`（再接続バナーは出さない）。

### オフライン対応（`offlineDB.js` + `useOnlineStatus.js`）

- **読み取りキャッシュ**: IndexedDB に nodes/categories を保存。Supabase 失敗時に自動フォールバック
- **ダーティキュー**: オフライン中の編集を `dirty_{userId}` に蓄積、オンライン復帰時に upsert
- **オンライン復帰**: `online` イベント → `syncOfflineChanges()` → Supabase へ upsert → `fetchNodes()` で再取得

| 操作 | オフライン時 |
|------|------------|
| コンテンツ編集・タイトル変更・折りたたみ | ✅ 可能（IndexedDBに保存） |
| ノード追加・削除・移動・ごみ箱操作 | ❌ 不可（`navigator.onLine` で早期 return） |

**安全設計**: IndexedDB が消えてもキューは空になるだけで、Supabase に「空」を送ることはない。

### カテゴリの自動作成ガード

`useCategories.js` は categories が空だと「無題のカテゴリ」を自動作成する。  
ただし `localStorage['namamemo_category_{userId}']` が存在する場合は「既存ユーザー」とみなし作成しない（Supabase不調での誤作成防止）。

### 管理者判定

`VITE_ADMIN_EMAILS` 環境変数に含まれるメールアドレス = 管理者。  
`AdminModal.jsx` の `isAdmin(email)` 関数で判定。管理者には🔧ボタンが表示される。

### Realtime とエコー防止

`useNodes.js` 内の Supabase Realtime サブスクリプションで他タブ/他デバイスの更新を検知。  
自分自身の書き込みによるエコーを `selfWrites` ref（TTL: 15秒）で防止している。

---

## 5. バージョン管理

更新履歴と現在バージョンは `src/components/ChangelogModal.jsx` で管理。

```js
export const VERSION = '1.02'  // ← ここを変更

const CHANGELOG = [
  { version: '1.02', date: '2026-05', items: ['...'] },
  // ...
]
```

---

## 6. 定数・制限値（`useSettings.js`）

| 定数 | 値 | 説明 |
|------|---|------|
| `MAX_LOGIN_COUNT` | 50 | 最大ユーザー数 |
| `MAX_DB_MB` | 10 | DB使用量上限（管理者パネルのバー表示に使用） |
| `MAX_STORAGE_MB` | 20 | ストレージ使用量上限（同上） |

---

## 7. 主要な依存ライブラリ

| ライブラリ | 用途 |
|-----------|------|
| React 19 | UI |
| Vite 8 | ビルド |
| @supabase/supabase-js 2 | DB・Auth・Storage |
| @tiptap/* 3 | リッチテキストエディタ |
| vite-plugin-pwa 0.21 | PWA / Service Worker |
| gh-pages 6 | GitHub Pages デプロイ |

---

## 8. よくある作業パターン

### コード修正 → デプロイ

```bash
npm run dev       # ローカル確認
npm run deploy    # ビルド＋GitHub Pagesにデプロイ
```

デプロイ後、PWAキャッシュが残っている場合はブラウザで **Ctrl+Shift+R** が必要。

### Supabase が応答しない場合

Supabase Dashboard → Settings → General → **Restart project** で復旧できることが多い。  
ステータス確認: `https://status.supabase.com/`

### RLS でデータが見えない場合

`supabase.from('nodes').select(...)` がエラーなしで `[]` を返す場合は RLS が原因のことが多い。  
SQL Editor で `SET ROLE authenticated;` を使ってテストするか、RLS ポリシーを確認する。

### PWA 更新が届かない場合

Service Worker の更新は自動検知される。アプリ内に「今すぐ反映」バナーが表示されるので、ユーザーはそれを押すだけでよい。

---

## 9. Claudeへの作業依頼時のコツ

- **ファイルの内容を貼る**: Claude Code と違いファイルを直接読めないため、修正対象ファイルの該当部分のコードを貼り付けてから依頼する
- **修正後はdiffで確認**: 変更箇所を明示してもらい、前後のコードを比較してから適用する
- **デプロイは手動**: コードを受け取ったらローカルで確認後、`npm run deploy` を自分で実行する
- **Supabase SQL の変更**: SQL Editor でコードを貼り付けて実行。型変更を伴う場合は `DROP FUNCTION` を先に実行
