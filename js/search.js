// search.js —— 联网搜索外规网页(Tavily / Serper / Bing 三家)
// 设计契约见 README 顶部注释。本文件只依赖浏览器原生 fetch,无第三方库。
//
// 导出:
//   searchRegulations(query, settings) -> Promise<Array<{ title, url, content, source }>>
// settings 来自 config.getSettings():使用 settings.searchProvider / searchKey / proxy。

// 从 URL 中安全提取 hostname,失败返回空字符串。
function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// 把搜索 API 的 HTTP 错误规整成带【标签】的标准提示。
function searchHttpError(provider, status) {
  if (status === 401 || status === 403) return '【搜索 Key 无效】联网搜索(' + provider + ')鉴权失败,请在「设置」核对搜索 API Key。';
  if (status === 429) return '【搜索限流】联网搜索(' + provider + ')请求过于频繁,请稍候再试。';
  return '【搜索失败(' + status + ')】联网搜索(' + provider + ')出错。';
}

// 包一层 fetch:把网络层异常(多数是浏览器 CORS 拦截)转成可读的中文引导。
async function safeFetch(url, opts, provider) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    throw new Error(
      '【搜索网络错误】(' + provider + ')无法连接。多数搜索 API 不允许浏览器跨域(CORS),' +
      '请在「设置」中配置「转发前缀」(指向你的无状态转发,如 Cloudflare Workers)绕过。原始错误:' +
      (e && e.message ? e.message : String(e))
    );
  }
}

// 联网搜索外规
// query    搜索关键词
// settings getSettings() 返回的对象
// 返回:按 url 去重、最多 8 条的结果数组
export async function searchRegulations(query, settings, opts) {
  const provider = (settings && settings.searchProvider) || 'tavily';
  const key = (settings && settings.searchKey) || '';
  const proxy = (settings && settings.proxy) || '';
  // 可选:把结果限定在这些权威来源域名(过滤公司文件/新闻噪音)
  const includeDomains = (opts && Array.isArray(opts.includeDomains)) ? opts.includeDomains : [];

  if (!key) {
    throw new Error('【未配置搜索 Key】请在「设置」填写联网搜索 API Key,或留空仅用内置法规库。');
  }

  // 代理用于绕过浏览器 CORS 限制:留空则浏览器直连;
  // 形如 'https://my-proxy/?url=' 的代理需自行处理拼接,这里统一采用「前缀拼接」。
  const wrap = (u) => (proxy ? proxy + u : u);

  let resp;
  let mapped = [];

  if (provider === 'tavily') {
    // Tavily:POST JSON,api_key 放在 body 中。
    resp = await safeFetch(wrap('https://api.tavily.com/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'advanced',
        max_results: 8,
        include_raw_content: true,
        ...(includeDomains.length ? { include_domains: includeDomains } : {}),
      }),
    }, provider);
    if (!resp.ok) {
      throw new Error(searchHttpError(provider, resp.status));
    }
    const data = await resp.json();
    const results = Array.isArray(data.results) ? data.results : [];
    mapped = results.map((r) => ({
      title: r.title || '',
      url: r.url || '',
      content: r.raw_content || r.content || '',
      source: hostname(r.url || ''),
    }));
  } else if (provider === 'serper') {
    // Serper(google.serper.dev):POST JSON,Key 放在 X-API-KEY 头。
    resp = await safeFetch(wrap('https://google.serper.dev/search'), {
      method: 'POST',
      headers: {
        'X-API-KEY': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn' }),
    }, provider);
    if (!resp.ok) {
      throw new Error(searchHttpError(provider, resp.status));
    }
    const data = await resp.json();
    const organic = Array.isArray(data.organic) ? data.organic : [];
    mapped = organic.map((r) => ({
      title: r.title || '',
      url: r.link || '',
      content: r.snippet || '',
      source: hostname(r.link || ''),
    }));
  } else if (provider === 'bing') {
    // Bing Web Search v7:GET,Key 放在 Ocp-Apim-Subscription-Key 头。
    const bingUrl =
      'https://api.bing.microsoft.com/v7.0/search?q=' +
      encodeURIComponent(query) +
      '&mkt=zh-CN';
    resp = await safeFetch(wrap(bingUrl), {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': key },
    }, provider);
    if (!resp.ok) {
      throw new Error(searchHttpError(provider, resp.status));
    }
    const data = await resp.json();
    const webPages =
      data.webPages && Array.isArray(data.webPages.value)
        ? data.webPages.value
        : [];
    mapped = webPages.map((r) => ({
      title: r.name || '',
      url: r.url || '',
      content: r.snippet || '',
      source: hostname(r.url || ''),
    }));
  } else {
    throw new Error('未知的搜索服务提供方:' + provider);
  }

  // 按 url 去重(保留首次出现),最多返回 8 条。
  const seen = new Set();
  const deduped = [];
  for (const item of mapped) {
    const u = item.url || '';
    if (!u || seen.has(u)) continue;
    seen.add(u);
    deduped.push(item);
    if (deduped.length >= 8) break;
  }

  return deduped;
}
