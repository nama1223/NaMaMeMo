/**
 * menuPosition.js
 *
 * 座標指定で開くポップアップ（コンテキストメニューや入力候補リスト）を
 * 画面内（端に余白 margin を確保）に収めるための位置計算ユーティリティ。
 * DOMに依存しない純関数なので、単体テストで検証できる。
 */

/**
 * ポップアップの左上座標を、画面内に収まるよう最小限の移動で補正する。
 *
 * @param {number} x 表示したい左位置
 * @param {number} y 表示したい上位置
 * @param {number} w ポップアップの幅
 * @param {number} h ポップアップの高さ
 * @param {number} vw 画面（ビューポート）の幅
 * @param {number} vh 画面（ビューポート）の高さ
 * @param {number} [margin=8] 画面端に確保する余白
 * @returns {{left: number, top: number, maxHeight: (number|null)}}
 *   maxHeight は、ポップアップ自体が画面より高くて移動だけでは収まらない
 *   場合にだけ「画面に収まる高さ」を返す（呼び出し側で内部スクロールさせる）。
 *   収まる場合は null。
 */
export function clampMenuPos(x, y, w, h, vw, vh, margin = 8) {
  const availW = Math.max(0, vw - margin * 2)
  const availH = Math.max(0, vh - margin * 2)

  let left
  if (w >= availW) left = margin
  else left = Math.min(Math.max(x, margin), vw - margin - w)

  let top
  let maxHeight = null
  if (h > availH) {
    // 画面より高い場合は上端に寄せ、はみ出す分は内部スクロールで見せる
    top = margin
    maxHeight = availH
  } else {
    top = Math.min(Math.max(y, margin), vh - margin - h)
  }
  return { left, top, maxHeight }
}
