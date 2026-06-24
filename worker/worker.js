// LexScope 联网搜索转发 Worker —— 无状态 CORS 转发
// ============================================================
// 作用:让纯静态网页(无后端)能调用「不支持浏览器跨域(CORS)」的搜索 API
//       (Tavily / Serper / Bing)。DeepSeek 本身允许跨域,可不经此转发。
//
// 原理:浏览器把请求发到本 Worker → Worker 在服务端转发到真实 API
//       (服务器之间无 CORS 限制)→ 把结果回写 CORS 头返回浏览器。
//
// 无状态:不写数据库、不记日志、不缓存任何请求内容或密钥。请求过完即忘。
//
// 前端配置:在 LexScope「设置 → 转发前缀」填本 Worker 网址(末尾带斜杠):
//       https://lexscope-proxy.你的子域.workers.dev/
//   前端会自动拼成:https://lexscope-proxy.你的子域.workers.dev/https://api.tavily.com/search
// ============================================================

// 仅允许转发到这些主机,避免本 Worker 被当成「开放代理」滥用。可按需增减。
const ALLOW_HOSTS = [
  'api.tavily.com',
  'google.serper.dev',
  'api.bing.microsoft.com',
  'api.deepseek.com', // 可选:若也想让模型调用经此转发
];

function corsHeaders(request) {
  // 反射浏览器预检里声明的自定义头(如 X-API-KEY / Authorization / Ocp-Apim-Subscription-Key)
  const reqHeaders = request.headers.get('Access-Control-Request-Headers');
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': reqHeaders || '*',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  });
}

export default {
  async fetch(request) {
    // 1) 预检请求(OPTIONS)直接放行
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // 2) 解析目标地址:优先 ?url= 参数,否则取路径后半段(后者能正确保留目标自带的查询串)
    const u = new URL(request.url);
    let target = u.searchParams.get('url');
    if (!target) {
      target = u.pathname.slice(1) + u.search; // 去掉开头的 '/'
    }
    if (!/^https?:\/\//i.test(target)) {
      return json({ error: 'LexScope 转发:缺少或非法的目标地址' }, 400, request);
    }

    // 3) 主机白名单校验
    let host;
    try {
      host = new URL(target).hostname;
    } catch (e) {
      return json({ error: 'LexScope 转发:目标地址无法解析' }, 400, request);
    }
    if (!ALLOW_HOSTS.includes(host)) {
      return json({ error: 'LexScope 转发:目标主机不在白名单内 → ' + host }, 403, request);
    }

    // 4) 透传转发(方法、头、体均原样转发;不记录任何内容)
    const fwdHeaders = new Headers(request.headers);
    fwdHeaders.delete('host');
    fwdHeaders.delete('origin');
    fwdHeaders.delete('referer');
    fwdHeaders.delete('content-length'); // 重设 body 后由运行时重新计算

    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.text(); // 这些 API 的请求体都很小,读成文本最稳
    }

    let resp;
    try {
      resp = await fetch(target, { method: request.method, headers: fwdHeaders, body });
    } catch (e) {
      return json({ error: 'LexScope 转发:请求上游失败 ' + (e && e.message ? e.message : '') }, 502, request);
    }

    // 5) 回写响应,并补上 CORS 头
    const outHeaders = new Headers(resp.headers);
    const cors = corsHeaders(request);
    for (const k in cors) outHeaders.set(k, cors[k]);
    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  },
};
