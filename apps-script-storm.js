// ════════════════════════════════════════════════════════════════
//  Google Apps Script — Proxy Portal Comissões
//  Fonte ÚNICA: Nova Financeira ContratoInfo (web scraping)
//  NÃO usa Storm OpenAPI — todos os dados vêm da NF
// ════════════════════════════════════════════════════════════════

var GAS_SECRET    = 'stormportal2026np';
var NF_BASE       = 'https://sistema.novafinanceira.com';
var NF_USER       = '6246';
var NF_PASS       = '6#uYtA!t\x22 N$u%}\x5c';
var NF_COOKIE_KEY = 'NF_COOKIE_V4';
var NF_PROP_KEY   = 'NF_COOKIE_MANUAL';

// ── Cookie: PropertiesService (manual) > CacheService (login) ─
function getNFCookie() {
  var props  = PropertiesService.getScriptProperties();
  var manual = props.getProperty(NF_PROP_KEY);
  if (manual) return manual;
  var cache  = CacheService.getScriptCache();
  var cached = cache.get(NF_COOKIE_KEY);
  if (cached) return cached;
  var payload = 'usuario=' + encodeURIComponent(NF_USER)
              + '&senha='  + encodeURIComponent(NF_PASS)
              + '&forceLogout=1&logar=Entrar';
  var resp = UrlFetchApp.fetch(NF_BASE + '/index.php', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    followRedirects: false,
    muteHttpExceptions: true
  });
  var body = resp.getContentText();
  if (body.indexOf('mfaLogin') !== -1) throw new Error('MFA_REQUIRED');
  var headers   = resp.getAllHeaders();
  var setCookie = headers['Set-Cookie'] || headers['set-cookie'];
  if (!setCookie) throw new Error('LOGIN_FAILED');
  var cookieArr = Array.isArray(setCookie) ? setCookie : [setCookie];
  var cookie    = cookieArr.map(function(c) { return c.split(';')[0]; }).join('; ');
  cache.put(NF_COOKIE_KEY, cookie, 3300);
  return cookie;
}

// ── Helpers ───────────────────────────────────────────────────
function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, '')
                  .replace(/&amp;/g, '&')
                  .replace(/&#37;/g, '%')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/\s+/g, ' ').trim();
}

function extractField(html, label) {
  var re = new RegExp(label + '[^<]*(?:<[^>]+>\\s*)+([^<]+)', 'gi');
  var m;
  while ((m = re.exec(html)) !== null) {
    var v = m[1].trim();
    if (v) return v;
  }
  return null;
}

function extractTdField(html, label) {
  var re = new RegExp('<td[^>]*>(?:[^<]|<(?!/td>))*' + label + '[^<]*(?:<[^>]+>\\s*)*<\\/td>\\s*<td[^>]*>\\s*([^<]+)', 'gi');
  var m;
  while ((m = re.exec(html)) !== null) {
    var v = m[1].trim();
    if (v) return v;
  }
  return null;
}

function parseTableByTdsTh(html, anchorLabel) {
  var anchorIdx = html.search(new RegExp(anchorLabel, 'i'));
  if (anchorIdx < 0) return {};
  var tableStart = html.lastIndexOf('<table', anchorIdx);
  if (tableStart < 0) tableStart = anchorIdx;
  var chunk = html.slice(tableStart, tableStart + 6000);

  var cells = [], re = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi, m;
  while ((m = re.exec(chunk)) !== null) cells.push(stripTags(m[1]));

  var dataStart = -1;
  for (var i = 0; i < cells.length; i++) {
    if (/^\d{2}\/\d{2}\/\d{4}/.test(cells[i]) || /^R\s*\$/.test(cells[i]) || /^\d[\d,.]+\s*%/.test(cells[i])) {
      dataStart = i;
      break;
    }
  }
  if (dataStart < 0) return {};

  var headers = cells.slice(0, dataStart).filter(function(h) { return h.length > 0 && h.length < 40; });
  var data    = cells.slice(dataStart, dataStart + headers.length);
  var result  = {};
  headers.forEach(function(h, i) { if (h) result[h] = data[i] || ''; });
  return result;
}

function parseTableByTds(html, sectionLabel) {
  return parseTableByTdsTh(html, sectionLabel);
}

// ── Detecta página de múltiplos contratos ────────────────────
function parseMultipleContracts(html) {
  var re = /contratoInfo\(['"]([\w\/\-\.]+)['"]\)/gi;
  var m, codes = [];
  while ((m = re.exec(html)) !== null) {
    if (codes.indexOf(m[1]) === -1) codes.push(m[1]);
  }
  return codes;
}

// ── Parse HTML do ContratoInfo ────────────────────────────────
function parseNFHtml(html, ade, codigoContrato) {
  var ln = parseTableByTdsTh(html, 'Linhas de comiss');
  var cp = parseTableByTdsTh(html, 'Total.*Repassado');
  if (!cp || !Object.keys(cp).length) {
    cp = parseTableByTdsTh(html, 'Comiss.*Repassada');
  }

  var sitFin  = extractField(html, 'Situa..o Financeiro') || extractField(html, 'Situação Financeiro');
  var sitCtr  = extractField(html, 'Situa..o Contrato')   || extractField(html, 'Situação Contrato');
  var dtPgto  = extractField(html, 'Data Pgto Cliente');
  var ctrPend = extractField(html, 'Contrato Pendente');

  // Dados hierarquia — extraídos diretamente do ContratoInfo
  var comercial = extractTdField(html, 'Comercial') || extractField(html, 'Comercial');
  var regional  = extractTdField(html, 'Regional')  || extractField(html, 'Regional');
  var banco     = extractTdField(html, 'Banco')     || extractField(html, 'Banco');

  // Normaliza banco: remove código de convênio após "/" se muito longo
  if (banco && banco.length > 60) banco = banco.slice(0, 60).trim();

  var valorBase       = ln['Valor Base']         || null;
  var statusComissao  = ln['Status']             || null;
  var valorComissao   = cp['Comissão Repassada'] || cp['Comissao Repassada'] || null;
  var totalPct        = cp['Total % Repassado']  || null;
  var valorTotal      = cp['Total % Repassado']  || null; // mesma coluna — valor absoluto
  var valorAdiant     = cp['Valor Adiantamento'] || null;
  var valorBaseBruto  = cp['Valor Base Bruto']   || null;
  var dataPagCom      = cp['Comissão paga']       || cp['Comissao paga'] || null;

  return {
    // Identificação
    codigo:    codigoContrato || null,
    ade:       ade            || null,
    banco:     banco          || null,

    // Hierarquia
    comercial: comercial || null,
    regional:  regional  || null,

    // Situação principal
    situacaoFinanceiro: sitFin || null,

    // Comissão paga (estrutura compatível com _portalRenderContrato)
    comissaoPaga: {
      dataPagamento:       dataPagCom      || null,
      valorBase:           valorBaseBruto  || valorBase || null,
      valorComissao:       valorComissao   || null,
      totalPctRepassado:   totalPct        || null,
      totalPercentual:     totalPct        || null,
      valorAdiantamento:   valorAdiant     || null,
      valorTotal:          valorTotal      || valorComissao || null
    },

    // Linhas de comissão (estrutura compatível com _portalRenderContrato)
    linhasComissao: [{
      valorBase:       valorBase      || '—',
      valorBaseBruto:  valorBaseBruto || '—',
      comissaoRecebida: null,
      comissaoValor:   valorComissao  || '—',
      adiantamento:    valorAdiant    || '—',
      importadoPor:    null,
      dataImportacao:  null,
      status:          statusComissao || '—'
    }],

    // Dados operacionais
    dadosOperacional: {
      situacaoContrato: sitCtr  || null,
      dataPgtoCliente:  dtPgto  || null,
      contratoPendente: ctrPend || null
    },

    fonte: 'web'
  };
}

// ── Scrape único contrato via POST com codigoContrato ─────────
function scrapeNFByCode(ade, codigoContrato, cookie) {
  try {
    var resp = UrlFetchApp.fetch(
      NF_BASE + '/E2D/ContratoInfo/visualizar&cod=' + encodeURIComponent(ade),
      {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'codigoContrato=' + encodeURIComponent(codigoContrato),
        headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' },
        muteHttpExceptions: true
      }
    );
    var html = resp.getContentText();
    if (html.indexOf('form_login') !== -1 || html.indexOf('mfaLogin') !== -1) {
      throw new Error('SESSION_EXPIRED');
    }
    return parseNFHtml(html, ade, codigoContrato);
  } catch(ex) {
    return { _erro: ex.message, codigo: codigoContrato, ade: ade };
  }
}

// ── Scrape ContratoInfo (detecta múltiplos contratos) ─────────
function scrapeNF(ade) {
  try {
    var cookie = getNFCookie();
    var resp   = UrlFetchApp.fetch(
      NF_BASE + '/E2D/ContratoInfo/visualizar&cod=' + encodeURIComponent(ade),
      { method: 'get', headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' }, muteHttpExceptions: true }
    );
    var html = resp.getContentText();
    if (html.indexOf('form_login') !== -1 || html.indexOf('mfaLogin') !== -1) {
      CacheService.getScriptCache().remove(NF_COOKIE_KEY);
      PropertiesService.getScriptProperties().deleteProperty(NF_PROP_KEY);
      throw new Error('SESSION_EXPIRED');
    }

    // Múltiplos contratos — extrai cada um via POST
    var codes = parseMultipleContracts(html);
    if (codes.length > 1) {
      return codes.map(function(code) {
        return scrapeNFByCode(ade, code, cookie);
      });
    }

    // Contrato único
    var result = parseNFHtml(html, ade, null);
    return [result];
  } catch(ex) {
    return { _erro: ex.message };
  }
}

// ── Scrape debug — retorna trecho do HTML bruto ───────────────
function scrapeNFDebug(ade) {
  var cookie = getNFCookie();
  var resp   = UrlFetchApp.fetch(
    NF_BASE + '/E2D/ContratoInfo/visualizar&cod=' + encodeURIComponent(ade),
    { method: 'get', headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' }, muteHttpExceptions: true }
  );
  var html = resp.getContentText();
  var idx  = html.search(/Situa.{1,5}o\s*Financeiro/i);
  var sfSnippet = idx >= 0 ? html.slice(Math.max(0, idx - 100), idx + 500) : 'NOT FOUND';
  var cpIdx = html.search(/Comiss.o paga/i);
  var cpSnippet = cpIdx >= 0 ? html.slice(cpIdx, cpIdx + 1500) : 'NOT FOUND';
  var totalPctIdx = html.search(/Total.*%.*Repassado/i);
  var totalPctSnippet = totalPctIdx >= 0 ? html.slice(Math.max(0, totalPctIdx - 200), totalPctIdx + 800) : 'NOT FOUND';
  var multiCodes = parseMultipleContracts(html);
  return {
    htmlLen: html.length,
    sfIdx: idx,
    sfSnippet: sfSnippet,
    cpSnippet: cpSnippet,
    totalPctIdx: totalPctIdx,
    totalPctSnippet: totalPctSnippet,
    isLogin: html.indexOf('form_login') !== -1 || html.indexOf('mfaLogin') !== -1,
    multiContratos: multiCodes
  };
}

// ── Lógica principal ─────────────────────────────────────────
function processAde(ade) {
  var result = scrapeNF(ade);
  if (!Array.isArray(result)) {
    if (result._erro) throw new Error(result._erro);
    return [result];
  }
  // Filtra erros individuais — retorna ao menos os que tiveram sucesso
  var ok = result.filter(function(r) { return !r._erro; });
  if (ok.length === 0 && result.length > 0 && result[0]._erro) {
    throw new Error(result[0]._erro);
  }
  return ok.length > 0 ? ok : result;
}

// ── storeCookie — armazena cookie manualmente no PropertiesService
function storeCookieAction(cookie) {
  PropertiesService.getScriptProperties().setProperty(NF_PROP_KEY, cookie);
  CacheService.getScriptCache().remove(NF_COOKIE_KEY);
  return { ok: true, msg: 'Cookie armazenado com sucesso' };
}

// ── Handler GET ───────────────────────────────────────────────
function doGet(e) {
  var out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);
  try {
    var token = e && e.parameter && e.parameter.token;
    if (token !== GAS_SECRET) {
      out.setContent(JSON.stringify({ error: 'unauthorized' }));
      return out;
    }
    var action = e && e.parameter && e.parameter.action;
    if (action === 'storeCookie') {
      var cookie = e.parameter.cookie || '';
      out.setContent(JSON.stringify(storeCookieAction(cookie)));
      return out;
    }
    if (action === 'debug') {
      var ade = e.parameter.ade;
      out.setContent(JSON.stringify(scrapeNFDebug(ade)));
      return out;
    }
    var ade = e && e.parameter && e.parameter.ade;
    if (!ade) {
      out.setContent(JSON.stringify({ error: 'ade obrigatorio' }));
      return out;
    }
    out.setContent(JSON.stringify(processAde(ade)));
  } catch(ex) {
    out.setContent(JSON.stringify({ error: ex.message }));
  }
  return out;
}

function doPost(e) {
  var out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);
  try {
    var body   = JSON.parse(e.postData.contents || '{}');
    var action = body.action;
    if (action === 'storeCookie') {
      out.setContent(JSON.stringify(storeCookieAction(body.cookie || '')));
      return out;
    }
    var ade = body.ade;
    if (!ade) {
      out.setContent(JSON.stringify({ error: 'ade obrigatorio' }));
      return out;
    }
    out.setContent(JSON.stringify(processAde(ade)));
  } catch(ex) {
    out.setContent(JSON.stringify({ error: ex.message }));
  }
  return out;
}
