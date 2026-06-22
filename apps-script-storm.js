// ════════════════════════════════════════════════════════════════
//  Google Apps Script — Proxy Storm (Portal Comissões)
//  Como publicar/atualizar:
//    1. script.google.com → abrir projeto existente
//    2. Substituir todo o código por este
//    3. Implantar > Gerenciar implantações > editar (lápis) > nova versão → Implantar
//    4. A URL continua a mesma — não precisa atualizar o dashboard
// ════════════════════════════════════════════════════════════════

var GAS_SECRET      = 'stormportal2026np';

// Storm OpenAPI
var STORM_USER      = '3504';
var STORM_PASS      = 'Promotoraaaa@@2405';
var STORM_CLIENT_ID = 'KxF2YZGcLTjk3WpaxEE7';
var STORM_BASE      = 'https://openapi.stormfin.com.br';

// Nova Financeira web system
var NF_BASE         = 'https://sistema.novafinanceira.com';
var NF_USER         = 'admin.kelly';
var NF_PASS         = 'Novapromotora@2026';

// ── Cache keys ────────────────────────────────────────────────
var STORM_TOKEN_KEY = 'STORM_TOKEN_V2';
var NF_COOKIE_KEY   = 'NF_COOKIE_V2';

// ── Storm auth ────────────────────────────────────────────────
function getStormToken() {
  var cache = CacheService.getScriptCache();
  var t = cache.get(STORM_TOKEN_KEY);
  if (t) return t;
  var resp = UrlFetchApp.fetch(STORM_BASE + '/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=password&username=' + encodeURIComponent(STORM_USER)
           + '&password='   + encodeURIComponent(STORM_PASS)
           + '&client_id='  + encodeURIComponent(STORM_CLIENT_ID),
    muteHttpExceptions: true
  });
  var d = JSON.parse(resp.getContentText());
  if (!d.access_token) throw new Error('Storm auth failed: ' + resp.getContentText());
  var ttl = Math.min((d.expires_in || 3600) - 60, 21600);
  cache.put(STORM_TOKEN_KEY, d.access_token, ttl);
  return d.access_token;
}

// ── Nova Financeira login ─────────────────────────────────────
function getNFCookie() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(NF_COOKIE_KEY);
  if (cached) return cached;

  var payload = 'usuario=' + encodeURIComponent(NF_USER) + '&senha=' + encodeURIComponent(NF_PASS);
  var resp = UrlFetchApp.fetch(NF_BASE + '/index.php', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    followRedirects: false,
    muteHttpExceptions: true
  });

  var body = resp.getContentText();
  if (body.indexOf('mfaLogin') !== -1) throw new Error('MFA_REQUIRED');

  var headers    = resp.getAllHeaders();
  var setCookie  = headers['Set-Cookie'] || headers['set-cookie'];
  if (!setCookie) throw new Error('LOGIN_FAILED');

  var cookieArr  = Array.isArray(setCookie) ? setCookie : [setCookie];
  var cookie     = cookieArr.map(function(c) { return c.split(';')[0]; }).join('; ');
  cache.put(NF_COOKIE_KEY, cookie, 3300);
  return cookie;
}

// ── Scrape ContratoInfo ───────────────────────────────────────
function scrapeNF(ade) {
  try {
    var cookie = getNFCookie();
    var resp = UrlFetchApp.fetch(
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

function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&#37;/g,'%').replace(/\s+/g,' ').trim();
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

function parseNFHtml(html) {
  var r = {};
  r.codigo      = extractField(html, 'C.digo Contrato') || extractField(html, 'Código Contrato');
  r.ade         = extractField(html, 'ADE');
  r.responsavel = extractField(html, 'Respons.vel') || extractField(html, 'Responsável');
  r.banco       = extractField(html, 'Banco\\/Conv.nio') || extractField(html, 'Banco');
  r.multiloja   = extractField(html, 'Multiloja');
  r.tipo        = extractField(html, 'Tipo de Opera..o') || extractField(html, 'Tipo de Operação');
  r.digitacao   = extractField(html, 'Data Digita..o Banco') || extractField(html, 'Data Digitação Banco');
  r.rateio      = extractField(html, 'Rateio');
  r.comercial   = extractField(html, 'Comercial');
  r.regional    = extractField(html, 'Regional');
  r.nomeTabela  = extractField(html, 'Nome Tabela');
  r.idTabela    = extractField(html, 'Id da tabela\\/prazo') || extractField(html, 'Id da tabela');
  r.situacaoFinanceiro = extractField(html, 'Situa..o Financeiro') || extractField(html, 'Situação Financeiro');

  // Linhas de comissão importadas (8 headers)
  var linhasVals = parseTdValues(html, 'Linhas de comiss');
  r.linhasComissao = [];
  if (linhasVals.length > 8) {
    var d = linhasVals.slice(8, 16);
    r.linhasComissao.push({
      valorBase:        d[0] || '—', valorBaseBruto:  d[1] || '—',
      comissaoRecebida: d[2] || '—', adiantamentoPct: d[3] || '—',
      importadoPor:     d[4] || '—', observacoes:     d[5] || '',
      dataImportacao:   d[6] || '—', status:          d[7] || '—'
    });
  }

  // Comissão paga (11 headers)
  var cpVals = parseTdValues(html, 'Comiss.o paga');
  r.comissaoPaga = null;
  if (cpVals.length > 11) {
    var row = cpVals.slice(11, 22);
    r.comissaoPaga = {
      dataPagamento:        row[0]  || '—',
      valorBase:            row[1]  || '—',
      valorBaseBruto:       row[2]  || '—',
      comissaoRepassadaPct: row[3]  || '—',
      valorComissao:        row[4]  || '—',
      adiantamentoPct:      row[5]  || '—',
      valorAdiantamento:    row[6]  || '—',
      totalPctRepassado:    row[7]  || '—',
      valorFiliado:         row[8]  || null,
      valorMaster:          row[9]  || null,
      valorTotal:           row[10] || '—'
    };
  }

  // Dados Operacional
  r.contratoPendente = extractField(html, 'Contrato Pendente');
  r.situacaoContrato = extractField(html, 'Situa..o Contrato') || extractField(html, 'Situação Contrato');
  r.dataPgtoCliente  = extractField(html, 'Data Pgto Cliente');
  r.historicoSit     = extractField(html, 'Hist.rico Situa..o') || extractField(html, 'Histórico Situação');

  // Master nome
  r.masterNome = null;
  if (r.multiloja) {
    var mm = r.multiloja.match(/Master\s*[:\-]?\s*\d+\s*-\s*(.+)/i);
    if (mm) r.masterNome = mm[1].trim();
  }

  return r;
}

// ── OpenAPI normalize (fallback) ──────────────────────────────
function isValidDate(s) {
  if (!s) return false;
  var b = s.split('T')[0];
  return b !== '0000-00-00' && b.replace(/[-0]/g,'') !== '';
}
function fmtDate(s) {
  if (!isValidDate(s)) return null;
  var d = s.split('T')[0].split('-');
  return d.length === 3 ? d[2]+'/'+d[1]+'/'+d[0] : null;
}
function fmtBRL(n) {
  if (!n && n !== 0) return '—';
  return 'R$ ' + Number(n).toFixed(2).replace('.',',').replace(/(\d)(?=(\d{3})+,)/g,'$1.');
}

function deriveSituacao(c) {
  var tcc = c.tabela_coeficiente_comissao, cor = c.corretor;
  var st  = (c.status_contrato && c.status_contrato.nome) || '';
  var temData = isValidDate(c.data_pgto_bc);
  if (!cor || !cor.usuario) return 'DADOS IMPORTADOS — USUÁRIO NÃO VINCULADO';
  if (/TOMAD/i.test(st))    return 'CONTRATO EM TOMADA DE DECISÃO';
  if (!tcc) return temData ? 'DADOS IMPORTADOS' : 'AGUARDANDO IMPORTAÇÃO (RELATÓRIO BANCO)';
  return temData ? 'COMISSÃO PAGA AO CORRETOR' : 'COMISSÃO DISPONÍVEL PARA PAGAMENTO';
}

function normalizeApi(c) {
  var cor  = c.corretor || {}, sala = cor.loja_sala || {};
  var com  = sala.responsavel || {}, reg = sala.regional || {};
  var tcc  = c.tabela_coeficiente_comissao || {};
  var sf   = deriveSituacao(c);
  var vb   = c.valor_liquido || c.valor_bruto || 0;
  var recP = parseFloat(tcc.comissao_recebida)             || 0;
  var repP = parseFloat(tcc.comissao_repassada)            || 0;
  var adtP = parseFloat(tcc.comissao_repassada_adiantamento) || 0;
  var repV = vb * repP / 100, adtV = vb * adtP / 100;

  var masterNome = '', multilojaStr = 'Não';
  if (sala.nome && sala.nome !== cor.nome) {
    masterNome  = sala.nome;
    multilojaStr = 'Sim - Filiado, Master: ' + masterNome;
  }

  var comissaoPaga = null;
  if (sf.includes('PAGA AO CORRETOR')) {
    comissaoPaga = {
      dataPagamento:        fmtDate(c.data_pgto_bc) || '—',
      valorBase:            fmtBRL(vb),
      valorBaseBruto:       '—',
      comissaoRepassadaPct: repP.toFixed(2) + ' %',
      valorComissao:        fmtBRL(repV),
      adiantamentoPct:      adtP > 0 ? adtP.toFixed(2)+' %' : '—',
      valorAdiantamento:    adtP > 0 ? fmtBRL(adtV) : '—',
      totalPctRepassado:    (repP + adtP).toFixed(2) + ' %',
      valorFiliado:         null,
      valorMaster:          null,
      valorTotal:           fmtBRL(repV + adtV)
    };
  }

  return {
    fonte: 'api',
    codigo: c.codigo || '—', ade: c.ade || '—',
    responsavel: cor.nome || '—',
    banco: (c.banco && c.banco.nome) || '—',
    tipo:  (c.operacao && c.operacao.nome) || '—',
    digitacao: fmtDate(c.data_pgto_bc) || '—',
    comercial: com.nome || cor.nome || '—',
    comercialCod: com.usuario || cor.usuario || '',
    regional:  reg.nome || '—',
    multiloja: multilojaStr, masterNome: masterNome, rateio: null,
    nomeTabela: (tcc.orgao_tabela && tcc.orgao_tabela.nome_tabela) || '—',
    idTabela:   tcc.id ? 'P.' + tcc.id : '—',
    situacaoFinanceiro: sf,
    linhasComissao: tcc.id ? [{
      valorBase: fmtBRL(vb), valorBaseBruto: '—',
      comissaoRecebida: recP.toFixed(2)+' %', adiantamentoPct: '—',
      importadoPor: '—', dataImportacao: fmtDate(c.data_pgto_bc)||'—', status: 'Analisada'
    }] : [],
    comissaoPaga: comissaoPaga,
    dadosOperacional: {
      contratoPendente: '—',
      situacaoContrato: (c.status_contrato && c.status_contrato.nome) || '—',
      dataPgtoCliente:  fmtDate(c.data_pgto_bc) || '',
      historicoSituacao: '—'
    }
  };
}

// ── Lógica principal ──────────────────────────────────────────
function processAde(ade) {
  // Tenta web system primeiro (só funciona quando MFA for removido)
  try {
    var nf = scrapeNF(ade);
    if (nf && !nf._erro && nf.ade && nf.ade !== '—') {
      nf.fonte = 'web';
      return [nf];
    }
  } catch(ex) { /* fallback */ }

  // Fallback: OpenAPI Storm
  var token = getStormToken();
  var resp  = UrlFetchApp.fetch(STORM_BASE + '/contratos?ade=' + encodeURIComponent(ade), {
    method: 'get', headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true
  });
  var raw   = JSON.parse(resp.getContentText());
  var items = (raw && raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
  return items.map(normalizeApi);
}

// ── Handlers GET e POST ───────────────────────────────────────
function doGet(e) {
  var out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);
  try {
    var token = e && e.parameter && e.parameter.token;
    if (token !== GAS_SECRET) { out.setContent(JSON.stringify({error:'unauthorized'})); return out; }
    var ade = e && e.parameter && e.parameter.ade;
    if (!ade) { out.setContent(JSON.stringify({error:'ade obrigatorio'})); return out; }
    out.setContent(JSON.stringify(processAde(ade)));
  } catch(ex) {
    out.setContent(JSON.stringify({error: ex.message}));
  }
  return out;
}

function doPost(e) {
  var out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var ade  = body.ade;
    if (!ade) { out.setContent(JSON.stringify({error:'ade obrigatorio'})); return out; }
    out.setContent(JSON.stringify(processAde(ade)));
  } catch(ex) {
    out.setContent(JSON.stringify({error: ex.message}));
  }
  return out;
}
