// 把 __DSH_BOOT__ 里的插件地址解析成可 fetch 的绝对 URL。
// 0.2.0 起 boot 条目是文档相对路径（plugins/??<id>/client.js&rev=…），
// 直接接到 origin 后面会变成非法端口。旧宿主的 /plugins/<id>/client.js 仍然适用。

export function pluginClientUrl(pageUrl, clientUrl) {
  const origin = new URL(pageUrl).origin
  return new URL(clientUrl, `${origin}/`).href
}
