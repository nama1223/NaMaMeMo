/**
 * withTimeout.js
 * Promise にタイムアウトを付ける小さなヘルパー。
 *
 * 電波の弱い場所では通信が「失敗」せず宙吊りになることがあり、
 * await が永遠に返らなくなる。起動系の通信ではこのヘルパーで見切り、
 * 呼び出し側は catch して端末内キャッシュの表示に切り替える。
 */
export function withTimeout(promise, ms, label = 'timeout') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
