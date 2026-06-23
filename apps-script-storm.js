// ════════════════════════════════════════════════════════════════
//  Google Apps Script — Proxy Portal Comissões
//  Fonte ÚNICA: Nova Financeira ContratoInfo (web scraping)
//  NÃO usa Storm OpenAPI — todos os dados vêm da NF
// ════════════════════════════════════════════════════════════════

var GAS_SECRET    = 'stormportal2026np';
var NF_BASE       = 'https://sistema.novafinanceira.com';
var NF_USER       = 'admin.kelly';
var NF_PASS       = 'Novapromotora@2026';
var NF_COOKIE_KEY = 'NF_COOKIE_V4';

// ── Login Nova Financeira ─────────────────────────────────────
function getNFCookie() {
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
  var re = new RegExp(label + '[^<]*<\\/[^>]+>\\s*<[^>]+>([^<]*)', 'i');
  var m  = html.match(re);
  return m ? m[1].trim() : null;
}

function parseTdValues(html, sectionLabel) {
  var idx = html.search(new RegExp(sectionLabel, 'i'));
  if (idx < 0) return [];
  var chunk = html.slice(idx, idx + 10000);
  var vals  = [], re = /<td[^>]*>([\s\S]*?)<\/td>/gi, m;
  while ((m = re.exec(chunk)) !== null) {
    var v = stripTags(m[1]);
    if (v) vals.push(v);
  }
  return vals;
}

// ── Parse HTML do ContratoInfo ────────────────────────────────
function parseNFHtml(html) {
  var r = {};

  // Dados básicos
  r.codigo      = extractField(html, 'C.digo Contrato') || extractField(html, 'Código Contrato');
  r.ade         = extractField(html, 'ADE');
  r.responsavel = extractField(html, 'Respons.vel')     || extractField(html, 'Responsável');
  r.banco       = extractField(html, 'Banco\\/Conv.nio') || extractField(html, 'Banco');
  r.multiloja   = extractField(html, 'Multiloja');
  r.tipo        = extractField(html, 'Tipo de Opera..o') || extractField(html, 'Tipo de Operação');
  r.digitacao   = extractField(html, 'Data Digita..o Banco') || extractField(html, 'Data Digitação Banco');
  r.rateio      = extractField(html, 'Rateio');
  r.comercial   = extractField(html, 'Comercial');
  r.regional    = extractField(html, 'Regional');
  r.nomeTabela  = extractField(html, 'Nome Tabela');
  r.idTabela    = extractField(html, 'Id da tabela\\/prazo') || extractField(html, 'Id da tabela');

  // Situação Financeiro — vem diretamente da NF, campo correto
  r.situacaoFinanceiro = extractField(html, 'Situa..o Financeiro') || extractField(html, 'Situação Financeiro');

  // Linhas de comissão importadas (8 colunas de header)
  var linhasVals = parseTdValues(html, 'Linhas de comiss');
  r.linhasComissao = [];
  if (linhasVals.length > 8) {
    var d = linhasVals.slice(8, 16);
    r.linhasComissao.push({
      valorBase:        d[0] || '—',
      valorBaseBruto:   d[1] || '—',
      comissaoRecebida: d[2] || '—',
      adiantamentoPct:  d[3] || '—',
      importadoPor:     d[4] || '—',
      observacoes:      d[5] || '',
      dataImportacao:   d[6] || '—',
      status:           d[7] || '—'
    });
  }

  // Comissão paga — 10 colunas padrão, 11 se multiloja (Filiado + Master)
  var cpVals = parseTdValues(html, 'Comiss.o paga');
  r.comissaoPaga = null;
  if (cpVals.length > 11) {
    var isMultilojaTab = /Filiado|Master/i.test(cpVals.slice(0, 13).join(' '));
    var dataStart = isMultilojaTab ? 12 : 11;
    var row = cpVals.slice(dataStart, dataStart + 11);
    r.comissaoPaga = {
      dataPagamento:        row[0]  || '—',
      valorBase:            row[1]  || '—',
      valorBaseBruto:       row[2]  || '—',
      comissaoRepassadaPct: row[3]  || '—',
      valorComissao:        row[4]  || '—',
      adiantamentoPct:      row[5]  || '—',
      valorAdiantamento:    row[6]  || '—',
      totalPctRepassado:    row[7]  || '—',
      valorFiliado:         isMultilojaTab ? (row[8]  || null) : null,
      valorMaster:          isMultilojaTab ? (row[9]  || null) : null,
      valorTotal:           isMultilojaTab ? (row[10] || '—') : (row[8] || '—')
    };
  }

  // Dados Operacional (aba OUTROS da NF)
  var contratoPendente = extractField(html, 'Contrato Pendente');
  var situacaoContrato = extractField(html, 'Situa..o Contrato') || extractField(html, 'Situação Contrato');
  var dataPgtoCliente  = extractField(html, 'Data Pgto Cliente');
  var historicoSit     = extractField(html, 'Hist.rico Situa..o') || extractField(html, 'Histórico Situação');
  r.dadosOperacional = {
    contratoPendente:  contratoPendente || '—',
    situacaoContrato:  situacaoContrato || '—',
    dataPgtoCliente:   dataPgtoCliente  || '',
    historicoSituacao: historicoSit     || '—'
  };

  // Master nome para multiloja
  r.masterNome = null;
  if (r.multiloja) {
    var mm = r.multiloja.match(/Master\s*[:\-]?\s*\d+\s*-\s*(.+)/i);
    if (mm) r.masterNome = mm[1].trim();
  }
  r.comercialCod = r.comercial ? r.comercial.split(' - ')[0].trim() : '';

  return r;
}

// ── Scrape ContratoInfo ───────────────────────────────────────
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
      throw new Error('SESSION_EXPIRED');
    }
    return parseNFHtml(html);
  } catch(ex) {
    return { _erro: ex.message };
  }
}

// ── Lógica principal — SOMENTE web scraping NF ───────────────
function processAde(ade) {
  var nf = scrapeNF(ade);
  if (nf._erro) {
    throw new Error(nf._erro);
  }
  nf.fonte = 'web';
  return [nf];
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
    var body = JSON.parse(e.postData.contents || '{}');
    var ade  = body.ade;
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
