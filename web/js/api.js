/* ---------- C. 外部 API 封装 ------------------------------------------- */

/** 带超时的 fetch */
async function fetchT(url, options, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 30000);
  try {
    return await fetch(url, Object.assign({ signal: ctl.signal }, options));
  } finally { clearTimeout(t); }
}

/**
 * 图片 OCR —— Hugging Face Inference API
 * 支持两种引擎：
 *  engine=vlm : 多模态大模型（OpenAI 兼容的 chat/completions 形式，中文整页效果好）
 *  engine=doc : 文档解析模型（直接把图片二进制作为请求体）
 * 返回识别出的纯文本；失败时抛 Error。
 */
async function hfOcr(file, token, model, engine) {
  if (!token) throw new Error('未填写 Hugging Face Token');

  if (engine === 'vlm') {
    const dataUrl = await fileToDataUrl(file);
    const res = await fetchT(
      'https://api-inference.huggingface.co/models/' + model + '/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: '请逐字转写图片中的所有文字，保持原有段落与标点，只输出文字本身，不要解释、不要加引号。' },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }]
        })
      }, 90000);
    if (!res.ok) throw new Error('OCR 接口返回 ' + res.status + '：' + await safeText(res));
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content || '';
    if (!txt.trim()) throw new Error('没有从图片中识别到文字');
    return txt.trim();
  }

  // 文档解析模型：请求体即图片本身
  const res = await fetchT(
    'https://api-inference.huggingface.co/models/' + model,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': file.type || 'image/png',
        'x-wait-for-model': 'true'
      },
      body: file
    }, 90000);
  if (!res.ok) throw new Error('OCR 接口返回 ' + res.status + '：' + await safeText(res));
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  const txt = flattenOcr(data);
  if (!txt.trim()) throw new Error('没有从图片中识别到文字');
  return txt.trim();
}

/** 兼容各家 OCR 模型的返回结构，拼成一段可读文本 */
function flattenOcr(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    // 常见形态：[{token_str|word|text|generated_text, score}] 或 [[{...}]]
    return data.map(x => flattenOcr(x)).filter(Boolean).join(' ');
  }
  if (typeof data === 'object') {
    for (const k of ['generated_text', 'full_text', 'extracted_text', 'text', 'token_str', 'word', 'output']) {
      if (typeof data[k] === 'string' && data[k].trim()) return data[k];
    }
    if (Array.isArray(data.output)) return data.output.map(flattenOcr).join(' ');
    if (Array.isArray(data.objects)) return data.objects.map(flattenOcr).join(' ');
    if (Array.isArray(data.tokens)) return data.tokens.map(flattenOcr).join(' ');
    return '';
  }
  return '';
}

/** 中文场景下 OCR 常把字间空格带进来，这里做轻量整理 */
function tidyOcrText(t) {
  return t
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '$1') // 去掉汉字之间的多余空格
    .replace(/\s+([，。！？；：、）》”’])/g, '$1')                 // 标点前不留空格
    .replace(/([（《“‘])\s+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('图片读取失败'));
    r.readAsDataURL(file);
  });
}
async function safeText(res) { try { return (await res.text()).slice(0, 200); } catch (e) { return ''; } }

/** 把网络/接口异常翻译成可操作的中文提示（评委现场演示最怕看不懂的红字） */
function friendlyErr(err) {
  const m = String((err && err.message) || err);
  if (/Failed to fetch|NetworkError|Load failed|net::/i.test(m)) return '请求未发出或被网络/代理拦截。请检查网络，或勾选“演示模式”先用本地算法完整体验';
  if (/abort/i.test(m)) return '请求超时（模型冷启动通常需 1 分钟），请稍后重试';
  if (/401|403|Unauthorized|Forbidden/i.test(m)) return '密钥无效或无该模型权限，请确认 Token 属于本人并已同意模型条款';
  if (/429/i.test(m)) return '调用频率受限，请稍候再试';
  if (/5\d\d/.test(m)) return '模型正在启动或过载，可稍等 20 秒重试，或换一个模型 ID';
  return m;
}

/**
 * 调用 Groq 对话补全，要求返回 JSON；解析失败时抽取第一个 {...} 再试一次。
 * 无 Key 或演示模式返回 null（调用方走本地兜底算法）。
 */
async function groqJSON(systemPrompt, userPrompt, timeoutMs) {
  const key = $('groqKey').value.trim();
  if (S.demoMode || !key) return null;
  const res = await fetchT('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: $('groqModel').value,
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt + '\n务必只输出一个合法的 JSON 对象，不要 Markdown 代码块，不要任何解释文字。' },
        { role: 'user', content: userPrompt }
      ]
    })
  }, timeoutMs || 30000);
  if (!res.ok) throw new Error('Groq 接口返回 ' + res.status + '：' + await safeText(res));
  const j = await res.json();
  const raw = j?.choices?.[0]?.message?.content || '';
  try { return JSON.parse(raw); } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    return null;
  }
}
