import { useRef } from 'react'

// プライバシーポリシーの表示モーダル。本文は承認済み下書き（2026-11-23 内容確定）と同一。
export default function PrivacyPolicyModal({ onClose }) {
  const overlayMouseDownTarget = useRef(null)
  return (
    <div
      style={styles.overlay}
      onMouseDown={e => { overlayMouseDownTarget.current = e.target }}
      onClick={e => {
        if (e.target === e.currentTarget && overlayMouseDownTarget.current === e.currentTarget) onClose()
        overlayMouseDownTarget.current = null
      }}
    >
      <div style={styles.modal} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>プライバシーポリシー</h2>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={styles.body}>
          <p style={styles.meta}>最終更新日: 2026年11月26日</p>
          <p style={styles.meta}>運営者: Nama（Nama Studio）</p>
          <p style={styles.p}>NaMaMeMo（以下「本サービス」）における利用者の情報の取り扱いについて、以下のとおり定めます。</p>

          <h3 style={styles.h}>1. 取得する情報</h3>
          <p style={styles.p}>本サービスの利用にあたり、次の情報を取得・保存します。</p>
          <ul style={styles.ul}>
            <li style={styles.li}><b>アカウント情報</b>: Googleアカウントによるログイン認証を通じて取得するメールアドレス等の識別情報、本サービス内で設定するニックネーム、アカウントの登録日時・最終ログイン日時</li>
            <li style={styles.li}><b>メモのデータ</b>: 利用者が作成したノード（メモ）のタイトル・本文・カテゴリ等の内容</li>
            <li style={styles.li}><b>添付ファイル</b>: 添付したファイルは、利用者自身の Google Drive 内に本サービスが作成するフォルダ（NamaStudio/NaMaMeMo）に保存されます。本サービスがアクセスできるのは、本サービス自身が作成したファイルに限られます</li>
            <li style={styles.li}><b>公開ページとコメント</b>: アプリ内の公開機能を使って公開したノードの内容は、公開用に発行される専用のURL（公開URL）を知る誰でも閲覧できます（アプリ本体のURLとは別のものです）。公開ページに投稿されたコメントは、投稿時の名前・本文・日時を保存します。また、荒らし対策と連投制限のため、投稿元のIPアドレスをハッシュ化（元のアドレスに戻せない形に変換）して保存します。公開ページの運営者が設定した管理者名も表示に使われます</li>
            <li style={styles.li}><b>端末内に保存される情報</b>: 設定や表示状態（ツリーの開閉状態など）の一部は、利用者の端末のブラウザ内（ローカルストレージ）に保存されます</li>
            <li style={styles.li}><b>アクセスログ</b>: 本サービスが利用するサーバー基盤において、IPアドレスやアクセス日時等のログが記録される場合があります</li>
          </ul>

          <h3 style={styles.h}>2. 利用目的</h3>
          <p style={styles.p}>取得した情報は、本サービスの提供（メモの保存・同期・公開、コメント機能、ログイン状態の維持）のためにのみ利用します。広告目的の利用や、利用者の行動追跡（トラッキング）は行いません。</p>
          <p style={styles.p}>運営者は、サービスの保守・障害対応などに必要な場合を除き、利用者のメモ内容を閲覧しません。ただし運営者はデータベースへのアクセス権限を持っており、大変めんどくさい手順を踏めば技術的には保存されたデータを閲覧できる立場にあることを、ここに明記します。</p>

          <h3 style={styles.h}>3. 利用している外部サービス</h3>
          <p style={styles.p}>本サービスは次の外部サービスを利用しており、各サービスの範囲で情報が処理されます。各サービスのプライバシーポリシーもあわせてご確認ください。</p>
          <ul style={styles.ul}>
            <li style={styles.li}><b>Supabase</b>: アカウント認証、メモ・コメント等のデータ保存</li>
            <li style={styles.li}><b>Google</b>: ログイン認証、添付ファイルの保存先（Google Drive）</li>
            <li style={styles.li}><b>GitHub Pages</b>: 本サービスの配信</li>
            <li style={styles.li}><b>Cloudflare</b>: 本サービスへの通信の転送</li>
          </ul>

          <h3 style={styles.h}>4. 第三者への提供</h3>
          <p style={styles.p}>法令に基づく場合を除き、取得した情報を第三者へ販売・提供することはありません（上記3の外部サービスの利用に伴う処理を除きます）。</p>

          <h3 style={styles.h}>5. データの削除</h3>
          <ul style={styles.ul}>
            <li style={styles.li}>メモや添付ファイルは、本サービス内の操作でいつでも削除できます</li>
            <li style={styles.li}>アカウント自体の削除は、設定画面の「一般」にある削除機能から行えます。削除すると、そのアカウントのメモ・コメント等のデータは全て削除され、元に戻すことはできません</li>
            <li style={styles.li}>アカウント削除の際は、Google Drive 内の添付ファイルと、その保存先のフォルダ（NaMaMeMoフォルダ）もあわせて削除します。親フォルダ（NamaStudio）は、他のアプリのファイルが残っていないことを確認できた場合に限り、削除します</li>
          </ul>

          <h3 style={styles.h}>6. お問い合わせ</h3>
          <p style={styles.p}>本ポリシーに関するお問い合わせは、Nama Studio トップページ（https://nama1223.com）のお問い合わせフォームからお願いします。個人で運営しているため、内容によっては返信できない場合があります。</p>

          <h3 style={styles.h}>7. 改定</h3>
          <p style={styles.p}>本ポリシーの内容は、必要に応じて改定することがあります。改定した場合は、本サービス内またはトップページでお知らせします。</p>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--bg)', borderRadius: 16, width: 560, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--text-muted)', width: 28, height: 28, borderRadius: 6 },
  body: { overflowY: 'auto', padding: '16px 20px 20px' },
  meta: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 },
  h: { fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '18px 0 8px' },
  p: { fontSize: 13, color: 'var(--text)', lineHeight: 1.7, marginBottom: 8 },
  ul: { margin: '0 0 8px', paddingLeft: 20 },
  li: { fontSize: 13, color: 'var(--text)', lineHeight: 1.7, marginBottom: 6 },
}
