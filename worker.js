/**
 * 寰球快讯 · Cloudflare Worker 版聚合后端（零依赖，可直接粘贴到 Workers 网页编辑器部署）
 * ------------------------------------------------------------------------------
 * 路由：
 *   GET /api/health           健康检查
 *   GET /api/categories       分类列表
 *   GET /api/news?cat=dev     某分类聚合结果
 *   GET /api/article?url=...  正文提取（内置轻量抽取，无需 jsdom）
 *
 * 可选环境变量（Workers 设置 → 变量）：
 *   RSSHUB_BASE   自托管 RSSHub 地址，默认公共实例 https://rsshub.app
 *   SIXTY_BASE    60s 聚合 API，默认 https://60s.viki.moe/v2
 *   ALLOW_ORIGIN  允许跨域来源，默认 *（生产建议填你的 Pages 域名）
 */

const DEFAULTS = {
  RSSHUB_BASE: 'https://rsshub.app',
  SIXTY_BASE: 'https://60s.viki.moe/v2',
  ALLOW_ORIGIN: '*',
};
const CACHE_TTL = 5 * 60 * 1000;   // 列表缓存 5 分钟
const ART_TTL = 60 * 60 * 1000;    // 正文缓存 1 小时
const memCache = new Map();        // isolate 内存缓存

const PLATFORM = {
  '60s': '60秒读世界', weibo: '微博热搜', zhihu: '知乎热榜',
  toutiao: '今日头条', douyin: '抖音热点', baidu: '百度热搜',
  bilibili: 'B站热门',  jianshu: '简书热门',
};

function buildConfig(env) {
  const RSSHUB = (env.RSSHUB_BASE || DEFAULTS.RSSHUB_BASE).replace(/\/$/, '');
  const rh = (p) => `${RSSHUB}${p}${p.includes('?') ? '&' : '?'}mode=fulltext`;
  return {
    RSSHUB, rh,
    SIXTY: (env.SIXTY_BASE || DEFAULTS.SIXTY_BASE).replace(/\/$/, ''),
    ORIGIN: env.ALLOW_ORIGIN || DEFAULTS.ALLOW_ORIGIN,
    categories: [
      { id: 'dev',  name: '码农',   sixty: [], rss: [
        { source: '掘金·前端', url: rh('/juejin/category/frontend') },
        { source: '掘金·后端', url: rh('/juejin/category/backend') },
        { source: '少数派',    url: rh('/sspai/matrix') },
        { source: '博客园',    url: 'https://feed.cnblogs.com/blog/sitehome/rss' },
        { source: 'V2EX',      url: 'https://www.v2ex.com/feed/tab/hot.xml' },
        { source: '开源中国',  url: rh('/oschina/news') },
        { source: '阮一峰周刊',url: rh('/ruanyifeng/weekly') },
        { source: 'IT之家',   url: 'https://www.ithome.com/rss/' },
        { source: 'InfoQ',    url: rh('/infoq/recommend') },
        { source: 'Solidot',  url: 'https://solidot.org/feed' },
      ]},
      { id: 'tech', name: '科技IT', sixty: [], rss: [
        { source: '36氪',     url: rh('/36kr/hot-list') },
        { source: '少数派',   url: rh('/sspai/matrix') },
        { source: 'IT之家',   url: 'https://www.ithome.com/rss/' },
        { source: '虎嗅',     url: rh('/huxiu/article') },
        { source: '极客公园', url: rh('/geekpark/breakingnews') },
        { source: '爱范儿',   url: rh('/ifanr') },
        { source: '钛媒体',   url: rh('/tmtpost') },
        { source: '品玩',     url: rh('/pingwest') },
        { source: 'Linux中国',url: 'https://linux.cn/rss.xml' },
      ]},
      { id: 'news', name: '资讯',   sixty: [], rss: [
        { source: '澎湃新闻', url: rh('/thepaper/featured') },
        { source: '知乎日报', url: rh('/zhihu/daily') },
        { source: '联合早报', url: rh('/zaobao/recommend') },
        { source: '人民网',   url: rh('/people/xjp') },
        { source: '新华网',   url: rh('/xinhua') },
        { source: 'Solidot', url: 'https://solidot.org/feed' },
      ]},
      { id: 'hot',  name: '热搜',   sixty: [], rss: [
        { source: '知乎热榜', url: rh('/zhihu/hot') },
        { source: 'B站热门',  url: rh('/bilibili/hot') },
        { source: '微博热搜', url: rh('/weibo/hot') },
        { source: '百度热搜', url: rh('/baidu/hot') },
        { source: '豆瓣电影', url: rh('/douban/movie/playing') },
        { source: '历史上的今天', url: rh('/history') },
      ]},
      { id: 'world', name: '国际',   sixty: [], rss: [
        { source: 'BBC',        url: 'https://feeds.bbci.co.uk/news/rss.xml' },
        { source: 'Reuters',    url: 'https://www.reutersagency.com/feed/' },
        { source: 'Guardian',   url: 'https://www.theguardian.com/world/rss' },
        { source: 'NYT',        url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
        { source: 'Hacker News',url: 'https://hnrss.org/frontpage' },
        { source: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
        { source: 'Ars Technica',url: 'https://feeds.arstechnica.com/arstechnica/index' },
        { source: 'Wired',      url: 'https://www.wired.com/feed/rss' },
        { source: 'CNBC',       url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147' },
      ]},
      { id: 'finance', name: '财经',   sixty: [], rss: [
        { source: '华尔街见闻', url: rh('/wallstreetcn/news/global') },
        { source: '财新网',   url: rh('/caixin/finance') },
        { source: 'FT中文网', url: rh('/ft/chinese') },
        { source: 'Bloomberg', url: 'https://www.bloomberg.com/feed/markets' },
        { source: 'CNBC',     url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147' },
      ]},
    ],
  };
}

/* ---------- 工具 ---------- */
const stripCDATA = (s) => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const stripTags = (s) => stripCDATA(s).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const sanitize = (h) => (h || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
  .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
const toTs = (d) => { if (!d) return 0; const t = new Date(String(d).replace(' ', 'T')).getTime(); return isNaN(t) ? 0 : t; };

function tag(block, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
  return m ? m[1] : '';
}

async function fetchText(url, ms = 15000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 NewsHub/CF' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(id); }
}

/* ---------- RSS 解析（正则，零依赖） ---------- */
function parseRss(xml, source) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.slice(0, 50).map((b) => {
    const title = stripTags(tag(b, 'title'));
    let link = stripTags(tag(b, 'link'));
    if (!link) { const m = /<link[^>]+href=["']([^"']+)["']/i.exec(b); if (m) link = m[1]; }
    const full = tag(b, 'content:encoded') || tag(b, 'content') || tag(b, 'description') || tag(b, 'summary');
    const date = stripTags(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    let img = '';
    const mm = /<(?:media:content|media:thumbnail|enclosure)[^>]+url=["']([^"']+)["']/i.exec(b) || /<img[^>]+src=["']([^"']+)["']/i.exec(full);
    if (mm) img = mm[1];
    return {
      title, link,
      desc: stripTags(full).slice(0, 120),
      content: sanitize(stripCDATA(full)),
      source, img, hot: toTs(date) / 1e7, date,
    };
  }).filter((i) => i.title && i.link);
}

/* ---------- 60s 平台 ---------- */
function parseHot(it) {
  if (typeof it.hot_value === 'number') return it.hot_value;
  const s = it.hot_value_desc || '';
  const m = /([\d.]+)\s*万/.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
async function fetchSixty(platform, cfg) {
  try {
    const txt = await fetchText(`${cfg.SIXTY}/${platform}`);
    const j = JSON.parse(txt);
    const src = PLATFORM[platform] || platform;
    const data = j && j.data;
    if (platform === '60s' && data && Array.isArray(data.news)) {
      return data.news.map((t) => ({ title: stripTags(t), link: data.link || '', desc: '', content: '', source: src, hot: 0, img: '' }));
    }
    if (!Array.isArray(data)) return [];
    return data.map((it) => ({
      title: stripTags(it.title), link: it.link || it.url || '',
      desc: stripTags(it.detail || it.desc || ''), content: '',
      source: src, hot: parseHot(it), img: it.cover || it.pic || '',
    })).filter((i) => i.title);
  } catch (e) { return []; }
}
async function fetchFeed(feed) {
  try { return parseRss(await fetchText(feed.url), feed.source); } catch (e) { return []; }
}

/* ---------- 聚合 ---------- */
async function aggregate(cat, cfg, limit = 0) {
  const results = await Promise.all([
    ...cat.sixty.map((p) => fetchSixty(p, cfg)),
    ...cat.rss.map(fetchFeed),
  ]);
  const seenTitle = new Set(); const seenLink = new Set(); const items = [];
  for (const arr of results) for (const it of arr) {
    const tk = it.title.replace(/[\s\p{P}]/gu, '').toLowerCase();
    const lk = it.link.replace(/[?#].*$/, '').toLowerCase();
    if (!tk || seenTitle.has(tk) || seenLink.has(lk)) continue;
    seenTitle.add(tk); seenLink.add(lk); items.push(it);
  }
  items.sort((a, b) => b.hot - a.hot);
  return limit > 0 ? items.slice(0, limit) : items;
}

/* ---------- 正文提取（轻量，无 jsdom） ---------- */
async function extractArticle(url) {
  const html = await fetchText(url, 15000);
  const titleM = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const ogImg = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html);
  let body = '';
  const artM = /<article[\s\S]*?<\/article>/i.exec(html);
  if (artM && stripTags(artM[0]).length > 120) body = artM[0];
  else {
    const ps = html.match(/<(p|h2|h3|blockquote)[^>]*>[\s\S]*?<\/\1>/gi) || [];
    body = ps.filter((p) => stripTags(p).length > 24).slice(0, 60).join('\n');
  }
  body = sanitize(body).replace(/\s(class|style|id|data-[\w-]+)="[^"]*"/gi, '');
  if (stripTags(body).length < 80) throw new Error('too short');
  return { title: titleM ? stripTags(titleM[1]) : '', content: body, image: ogImg ? ogImg[1] : '', url };
}

/* ---------- HTTP ---------- */
function json(obj, cfg, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': cfg.ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'public, max-age=120',
    },
  });
}

export default {
  async fetch(request, env) {
    const cfg = buildConfig(env);
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': cfg.ORIGIN, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    }

    if (path === '/api/health') return json({ ok: true, time: new Date().toISOString() }, cfg);

    if (path === '/api/categories')
      return json(cfg.categories.map((c) => ({ id: c.id, name: c.name })), cfg);

    if (path === '/api/news') {
      const id = url.searchParams.get('cat') || cfg.categories[0].id;
      const force = url.searchParams.get('force') === '1';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '0', 10) || 0, 200);
      const cat = cfg.categories.find((c) => c.id === id);
      if (!cat) return json({ error: '未知分类' }, cfg, 404);
      const hit = memCache.get('news:' + id);
      if (hit && !force && Date.now() - hit.ts < CACHE_TTL) {
        const items = limit > 0 ? hit.data.items.slice(0, limit) : hit.data.items;
        return json({ ...hit.data, count: items.length, items }, cfg);
      }
      const items = await aggregate(cat, cfg, limit);
      const data = { cat: id, updated: new Date().toISOString(), sources: [...new Set(items.map((i) => i.source))], count: items.length, items };
      if (items.length) memCache.set('news:' + id, { ts: Date.now(), data });
      return json(data, cfg);
    }

    if (path === '/api/article') {
      const target = url.searchParams.get('url');
      if (!target) return json({ error: '缺少 url' }, cfg, 400);
      const hit = memCache.get('art:' + target);
      if (hit && Date.now() - hit.ts < ART_TTL) return json(hit.data, cfg);
      try {
        const data = await extractArticle(target);
        memCache.set('art:' + target, { ts: Date.now(), data });
        return json(data, cfg);
      } catch (e) {
        return json({ error: '无法提取正文（热搜聚合页/JS渲染页/需登录）' }, cfg, 404);
      }
    }

    return json({ error: 'Not Found', routes: ['/api/health', '/api/categories', '/api/news?cat=dev', '/api/news?cat=world', '/api/news?cat=finance', '/api/article?url='] }, cfg, 404);
  },
};
