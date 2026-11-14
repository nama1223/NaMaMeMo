# ネイティブダイアログ置換（第1弾）進捗

## 調査
- 既存の設定・管理者モーダルはテーマCSS変数（`--bg` / `--surface` / `--border` / `--text` / `--accent`）と角丸、オーバーレイを使う構成。共通確認モーダルも同じ変数と既存のボタン表現に揃える。
- 置換対象の `window.confirm` は TreePane 3、CategoryBar 1、EditorPane 1、SettingsModal 1、AdminModal 1 の計7箇所。
- `src/components/bkup/` は検索上importなし。現行 `EditorPane.jsx` と `PublicViewer.jsx` は `src/components/RichEditor.jsx` を使用。今回は旧ファイルを変更しない。
- `alert()` は今回置換しない。調査時の呼び出し一覧（第2弾候補）:
  - `src/App.jsx`: Google API未読込、公開設定変更失敗、公開/非公開完了、URLコピー完了/失敗、診断結果の保存先未選択、未対応ファイル形式、インポート失敗
  - `src/hooks/useReminder.js`: 通知許可が必要
  - `src/hooks/useCategories.js`: 最後のカテゴリ削除不可
  - `src/hooks/useDriveMigration.js`: Google Drive連携が必要
  - `src/components/Auth.jsx`: ニックネーム未入力、ログインエラー
  - `src/components/AdminModal.jsx`: 自分自身の削除不可、削除エラー
  - `src/components/ReminderModal.jsx`: 未来日時指定、通知許可
  - `src/components/RichEditor.jsx`: PDF/動画/音声保存失敗、Drive認証切れ/保存失敗、画像アップロード失敗、未対応ファイル、圧縮画像保存失敗、クリップボード失敗時のURL表示
  - `src/components/bkup/RichEditor.jsx`: 画像アップロード失敗、未対応ファイル、圧縮画像保存失敗（旧ファイル、未import）
- `src/hooks/usePWA.js` の `installPrompt.prompt()` は対象外。

## 実装・確認結果
- `DialogProvider` と `useDialog` を追加。Promiseベースの `confirm(message)` / `alert(message)` を提供し、アプリルート（`main.jsx` の App ラッパー）にホストを1つ設置。
- 既存モーダルと同じテーマ変数・角丸・ボタンの雰囲気でスタイルを追加。キャンセル、オーバーレイクリック、Escapeでconfirmをキャンセルできる。
- TreePane（完全削除3）、CategoryBar（カテゴリ削除）、EditorPane（ごみ箱を空にする）、SettingsModal（バックアップ復元）、AdminModal（ユーザーデータ削除）の計7箇所を置換。文言は従来のまま。
- 指定ファイルに `window.confirm` は残っていない。`usePWA.js` のインストールAPIは未変更。
- `npm run build`: 成功。Vite buildとService Worker生成が完了。大きなchunk（約1.1MB）警告とinlineDynamicImports非推奨警告あり。

## 変更ファイル
- `PROGRESS-dialog.md`
- `src/components/DialogProvider.jsx`
- `src/main.jsx`
- `src/index.css`
- `src/components/TreePane.jsx`
- `src/components/CategoryBar.jsx`
- `src/components/EditorPane.jsx`
- `src/components/SettingsModal.jsx`
- `src/components/AdminModal.jsx`

## 残作業
- 第2弾として `alert()` 呼び出しをアプリ内ダイアログへ置換（今回の範囲外）。
- ビルド警告のchunk分割・非推奨設定対応（今回の範囲外）。

## 第2弾: alert置換
- 対象に挙げた8ファイルの全ネイティブ `alert()` 呼び出しを `useDialog()` の `alert` に置換。文言は現行と同一。
- async処理では、元の alert が後続処理を同期的に止めていた箇所（通知許可失敗、公開操作結果、診断/インポートエラー、ファイル処理エラー等）を `await alert(...)` とし、表示中に処理が先へ進まないようにした。クリップボード結果通知も完了を待つ。
- 呼び出し箇所はすべて Reactコンポーネントまたはカスタムフック内で、モジュールレベル関数からの呼び出しはなかった。`RichEditor.jsx` 内の `CompressDialog` と `HomeShortcutModal` も各コンポーネントで `useDialog()` を利用。
- ネイティブ `prompt()` は対象ソースに未検出。`usePWA.js` の `installPrompt.prompt()` はPWA APIのため変更なし。`src/components/bkup/` のalertは未importの旧バックアップのため変更なし。
- 最終grepでは対象外を除きネイティブ `alert` / `confirm` / `prompt` の残存なし。出力に残るダイアログ呼び出しは `useDialog` 経由で、`bkup/RichEditor.jsx` のalert 3箇所と `usePWA.js` の `installPrompt.prompt()` のみが対象外として残る。
- `npm run build`: 成功。Vite buildとService Worker生成が完了。chunkサイズ警告と `inlineDynamicImports` 非推奨警告は継続。

## 第3弾: ヘッドレス検証
- 環境確認: PATH上に `chromium` / `chromium-browser` / `google-chrome` / `google-chrome-stable` はなかった。Puppeteerキャッシュ内に Chromium 156.0.8078.47 と headless shell があった。
- `DialogProvider` を直接importした一時Reactハーネスを作成し、TreePaneと同じ `await confirm(\`「${title}」を完全に削除しますか？\\nこの操作は取り消せません。\`)` の呼び出しと、trueの場合のみ対象を削除する処理を組んだ。Viteでハーネスの一時ビルドは成功。
- ヘッドレス実行: Chromiumは起動時に `setsockopt: Operation not permitted`（Crashpad）で終了し、`--dump-dom` のDOMを得られなかった。headless shellも sandbox host の `Operation not permitted` で終了した。確認のため開発サーバーおよび `python3 -m http.server` でのdist配信も試みたが、どちらもポートbindが `listen EPERM` / `PermissionError` で拒否された。利用可能な jsdom / happy-dom / linkedom も見つからなかった。
- シナリオ結果: (a) モーダル表示、(b) OKでtrueかつ削除、(c) キャンセルでfalseかつ保持、(d) Escapeでfalseかつ保持はいずれも **未実行**。ブラウザがDOMを出力する前に起動失敗したため、PASS/FAILの実行結果は得られていない。ハーネスのビルド成功は実動作の証拠ではない。
- dist初期表示: **未検証**。配信サーバーとブラウザを起動できなかった。静的確認では `dist/index.html` に `#root` とビルド済みJS/CSSの参照があることを確認したが、認証画面の描画や実行時エラーの有無は判定していない。ログイン後の実画面での削除操作も未検証。
- 一時ハーネス、設定ファイル、一時ビルドはプロジェクト外（`/tmp`）を含め削除した。納品ソースには検証用コードを残していない。

## 第1弾〜第3弾の最終変更ファイル（納品対象）
- `src/components/DialogProvider.jsx`
- `src/main.jsx`
- `src/index.css`
- `src/components/TreePane.jsx`
- `src/components/CategoryBar.jsx`
- `src/components/EditorPane.jsx`
- `src/components/SettingsModal.jsx`
- `src/components/AdminModal.jsx`
- `src/App.jsx`
- `src/hooks/useReminder.js`
- `src/hooks/useCategories.js`
- `src/hooks/useDriveMigration.js`
- `src/components/Auth.jsx`
- `src/components/ReminderModal.jsx`
- `src/components/RichEditor.jsx`

### 第2弾の変更ファイル
- `PROGRESS-dialog.md`
- `src/App.jsx`
- `src/hooks/useReminder.js`
- `src/hooks/useCategories.js`
- `src/hooks/useDriveMigration.js`
- `src/components/Auth.jsx`
- `src/components/AdminModal.jsx`
- `src/components/ReminderModal.jsx`
- `src/components/RichEditor.jsx`

## 第3弾-2（jsdom検証）
- 目的: 実ブラウザを起動できなかった第3弾を補うため、Node + jsdomで `DialogProvider` のDOMレベル動作を検証する。
- 実施状況: `/tmp/dialog-verify/` に独立したnpm環境を作成し、jsdomおよび一時ハーネス用依存のインストールを試みた。npm installは出力がないまま停止し、タイムアウト付きの再試行も完了しなかった。既存のワークスペース内にもjsdomは見つからず、Viteハーネスのビルドおよびjsdomでの実行には進めなかった。
- シナリオ結果: (a) 削除モーダルのDOM表示、(b) OKでconfirmがtrueに解決し対象削除、(c) キャンセルでfalseに解決し対象維持、(d) Escapeでfalseに解決、(e) alert表示後OKで閉じる、の5項目すべて **未実行**。DOMのPASS/FAIL出力も得られていないため、成功扱いにはしていない。
- ネイティブダイアログ最終grep: `src` を対象に `bkup` と `src/hooks/usePWA.js` を除外して実施。`window.confirm` / `window.alert` / `window.prompt` のネイティブ呼び出しは0件。検索結果に現れる `confirm(...)` / `alert(...)` は `useDialog()` から得たアプリ内ダイアログ関数で、`usePWA.js` の `installPrompt.prompt()` は指定どおり除外。
- 検証できなかった範囲: jsdomでのDOM動作自体が未実行。実ブラウザでの表示・見た目検証、および実ログイン後の画面操作も未検証。
- 一時環境: `/tmp/dialog-verify/` は検証終了後に削除。アプリの `package.json` / `package-lock.json` およびアプリソースにハーネスを追加していない。
- 納品対象一覧を再確認。第1弾〜第3弾のソース変更15ファイルと本進捗記録が一致しており、変更なし。


## 第3弾-3（jsdom検証・実施結果）
- 実施: `/tmp/dialog-verify/node_modules/jsdom` を `require` して利用（npm installは未実行）。実物の `src/components/DialogProvider.jsx` をimportする一時Reactハーネスを用意し、TreePaneと同じ削除確認文言で `await confirm(...)` を呼び、trueのときだけ対象を削除するフローを構成した。ViteでIIFEバンドルを `/tmp/dialog-harness-dist` にビルドできた。
- ランナーは `JSDOM` の `runScripts: 'dangerously'` と `pretendToBeVisual: true` を指定し、バンドルをHTMLに埋め込んで実行した。最初はReactバンドルが参照する `process` がなく `ReferenceError: process is not defined` で停止。ランナー側に `window.process = { env: { NODE_ENV: 'production' } }` を追加して再実行したが、シナリオ結果DOMが確定せず、30秒の上限までに結果を取得できなかった。追加のwindowエラー記録でも有用な例外は得られず、2回目は `runner started` の後に結果出力がなかった。
- シナリオ結果: (a) 削除操作でモーダル表示 **未判定**、(b) OKでtrueに解決し対象が消える **未判定**、(c) キャンセルでfalseに解決し対象が残る **未判定**、(d) Escapeでfalseに解決 **未判定**、(e) alert表示後OKで閉じる **未判定**。DOMのPASS/FAIL出力が確定しなかったため、いずれも成功扱いにしていない。
- 使用したスタブ: ランナーの `window.process.env.NODE_ENV` のみ（バンドル起動時の参照用）。`matchMedia` 等のブラウザAPIスタブは追加していない。最初の実行で不足が確認された `process` はこのスタブ後に例外が解消したが、結果未確定の原因は特定できていない。
- 再現手順: 一時ハーネスを同じVite設定でビルドし、`node /tmp/run-dialog-jsdom.cjs` を実行。最初の試行では `process is not defined`、スタブ後の試行では約30秒以内にDOM結果が確定せず、出力なしでタイムアウトした。
- 検証できなかった範囲: 各シナリオの実行結果、実ブラウザでの見た目、実ログイン後の画面操作。
- 後片付け: 一時エントリ、Vite設定、`/tmp/run-dialog-jsdom.cjs`、`/tmp/dialog-harness-dist` を削除。アプリの依存ファイルは変更していない。

## 第4弾: alert の再分類

### 基盤
- `DialogProvider` に `toast(message)` と `banner(message)` を追加。トーストは4秒で自動消去し複数表示可能。常駐バナーはユーザーが閉じるまで残り、同じ文言は重複表示しない。
- 通知は操作をブロックせず、テーマ変数 `--surface` / `--bg` / `--border` / `--text` を使って画面上部（常駐バナー）・画面下部（トースト）に表示。
- 第1弾の `confirm` 呼び出し・モーダルは変更なし。

### 第2弾で置換した alert 呼び出しの対応表
| ファイル | メッセージ要旨（現行文言を維持） | 振り分け先 | 理由 |
|---|---|---|---|
| `src/App.jsx` | Google API未読込・再接続案内 | **常駐バナー** | 認証再接続の対応が必要で、後回しにされうる |
| `src/App.jsx` | 公開設定変更失敗（詳細） | **常駐バナー** | 操作失敗の詳細を後から確認できるようにする |
| `src/App.jsx` | メモ公開・公開停止の完了 | トースト | 一過性の完了報告 |
| `src/App.jsx` | 公開リンクのコピー完了（URLを含む） | トースト | 完了報告でURLは再取得可能 |
| `src/App.jsx` | コピー失敗＋手動コピー用URL | **常駐バナー** | URLが消えると手動コピーできなくなる |
| `src/App.jsx` | 診断書き出し先のメモ未選択 | トースト | 現在の操作への即時フィードバック |
| `src/App.jsx` | 未対応ファイル形式 | トースト | 現在のファイル選択への即時フィードバック |
| `src/App.jsx` | インポート失敗（詳細） | **常駐バナー** | 失敗の詳細を保持する |
| `src/hooks/useReminder.js` | 通知の許可が必要 | **常駐バナー** | ブラウザー設定での対応が必要 |
| `src/hooks/useCategories.js` | 最後のカテゴリは削除できない | トースト | 現在の削除操作への即時フィードバック |
| `src/hooks/useDriveMigration.js` | Google Drive連携が必要 | **常駐バナー** | 移設開始前に設定で対応が必要 |
| `src/components/Auth.jsx` | ニックネーム未入力 | トースト | 現在のフォームへの即時フィードバック |
| `src/components/Auth.jsx` | ログインエラー（詳細） | **常駐バナー** | 失敗理由を保持する |
| `src/components/AdminModal.jsx` | 自分自身は削除できない | トースト | 現在の削除操作への即時フィードバック |
| `src/components/AdminModal.jsx` | 削除中のエラー（詳細） | **常駐バナー** | 削除失敗の詳細を保持する |
| `src/components/ReminderModal.jsx` | 未来の日時を指定してください | トースト | 現在の日時入力への即時フィードバック |
| `src/components/ReminderModal.jsx` | 通知を許可してください | **常駐バナー** | 通知設定での対応が必要 |
| `src/components/RichEditor.jsx` | PDF保存失敗（詳細） | **常駐バナー** | 保存失敗の詳細を保持する |
| `src/components/RichEditor.jsx` | 動画保存失敗（詳細） | **常駐バナー** | 保存失敗の詳細を保持する |
| `src/components/RichEditor.jsx` | 音声保存失敗（詳細） | **常駐バナー** | 保存失敗の詳細を保持する |
| `src/components/RichEditor.jsx` | Google Drive認証切れ・再認証案内 | **常駐バナー** | 再ログインと再承認の対応が必要 |
| `src/components/RichEditor.jsx` | Google Drive保存失敗（詳細） | **常駐バナー** | 保存失敗の詳細を保持する |
| `src/components/RichEditor.jsx` | 画像アップロード失敗（詳細） | **常駐バナー** | アップロード失敗の詳細を保持する |
| `src/components/RichEditor.jsx` | 未対応ファイル形式（ファイル名付き） | トースト | 現在のファイル選択への即時フィードバック |
| `src/components/RichEditor.jsx` | 圧縮画像保存失敗（詳細） | **常駐バナー** | 保存失敗の詳細を保持する |
| `src/components/RichEditor.jsx` | ショートカット用URL（クリップボード失敗時） | **常駐バナー** | 元のURLを表示し続け、手動コピー可能にする |

## 第5弾（最終検証・補足）
- 第3弾-2/-3 で未判定だった jsdom 検証を、親側で再実施して完了した。方法: 実物の `DialogProvider` を使う一時ハーネスを Vite の lib モード（IIFE）でバンドルし、Node + jsdom（runScripts 有効）で実行。ランナー側スタブ: `window.process.env.NODE_ENV`、`MessageChannel`/`MessagePort`（Node worker_threads から）。
- 結果は **11項目すべて PASS**: (a) 削除確認モーダル表示と文言一致、(b) OK で true に解決し対象削除、(c) キャンセルで false・対象維持、(d) Escape で false・対象維持、(e) alert モーダル表示（OKのみ）と解決、(f) トースト表示と自動消去、(g) バナーの重複防止・常駐（自動で消えない）・閉じるボタンで消去。
- 未検証のまま残る範囲: 実ブラウザでの見た目、実ログイン後の実画面での操作（このVMでは実Chromiumがポリシーで起動できないため）。
- 検証用の一時ファイル（ハーネス・Vite設定・ランナー）は全て削除済みで、アプリソースには残っていない。

### 処理順・最終確認
- トースト/バナーは同期登録の fire-and-forget 通知にし、旧 `await alert(...)` の待機を除去。分類した通知は情報報告・入力フィードバックのため、後続処理を止める必要はない。
- 公開設定失敗は通知後に別の副作用なし。公開成功時は状態更新後に通知。状態 setter がない場合はトーストが見えるよう4秒後にリロードする。インポート成功時の既存リロードは成功トースト対象ではなく、そのまま維持。
- 「サーバー側に最新があります」に相当する通知は現行コードに見つからず（`最新` 等で検索）、該当する alert 呼び出しなし。
- ネイティブダイアログ最終grep: `src` から `src/components/bkup/` と `src/hooks/usePWA.js` を除外して検索。ネイティブ `alert` / `confirm` / `prompt` は **0件**。残る `confirm(...)` は第1弾の `useDialog()` アプリ内モーダルのみ。除外対象の `bkup/RichEditor.jsx` に旧 alert 3箇所、`usePWA.js` に `installPrompt.prompt()` が残る。
- `npm run build`: **成功**（Vite production build と Service Worker 生成完了）。大きなchunkと `inlineDynamicImports` の既存警告あり。
