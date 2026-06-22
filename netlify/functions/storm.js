const https = require('https');

// ── Credenciais Web System ────────────────────────────────────────────────────
const NOVA_USER = 'admin.kelly';
const NOVA_PASS = 'Novapromotora@2026';
const NOVA_HOST = 'sistema.novafinanceira.com';

// ── Credenciais OpenAPI (fallback enquanto MFA estiver ativo) ─────────────────
const API_USER      = '3504';
const API_PASS      = 'Promotoraaaa@@2405';
const API_CLIENT_ID = 'KxF2YZGcLTjk3WpaxEE7';
const API_HOST      = 'openapi.stormfin.com.br';

var _cookie    = null;
var _cookieExp = 0;
var _apiToken  = null;
var _apiTokenExp = 0;

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpReq(options, body) {
  return new Promise(function(resolve, reject) {
    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Web System login ──────────────────────────────────────────────────────────
async function webLogin() {
  var body = 'usuario=' + encodeURIComponent(NOVA_USER) + '&senha=' + encodeURIComponent(NOVA_PASS);
  var res = await httpReq({
    hostname: NOVA_HOST,
    path: '/index.php',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Mozilla/5.0'
    }
  }, body);

  if (res.body.includes('mfaLogin')) throw new Error('MFA_REQUIRED');

  var cookies = (res.headers['set-cookie'] || []).map(function(c) { return c.split(';')[0]; });
  if (!cookies.length) throw new Error('LOGIN_FAILED');
  _cookie    = cookies.join('; ');
  _cookieExp = Date.now() + 55 * 60 * 1000; // 55 min
  return _cookie;
}

async function getWebCookie() {
  if (_cookie && Date.now() < _cookieExp) return _cookie;
  return await webLogin();
}

// ── HTML parser ───────────────────────────────────────────────────────────────
function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#37;/g,'%').replace(/\s+/g,' ').trim();
}

function extractField(html, label) {
  // Matches: <td...>Label:</td><td...>VALUE</td>  (with optional whitespace)
  var re = new RegExp(label + '[^<]*<\\/[^>]+>\\s*<[^>]+>([^<]*)', 'i');
  var m  = html.match(re);
  return m ? stripTags(m[1]) : null;
}

function extractAfterColon(html, label) {
  // Matches: label: VALUE  anywhere in text
  var re = new RegExp(label + '\\s*:\\s*</[^>]+>\\s*<[^>]+>([^<]+)', 'i');
  var m  = html.match(re);
  if (m) return stripTags(m[1]);
  // fallback: label: VALUE  as plain text
  var re2 = new RegExp(label + '\\s*:([^<\\n]{1,120})', 'i');
  var m2  = html.match(re2);
  return m2 ? m2[1].trim() : null;
}

function parseTdValues(html, sectionLabel) {
  // Extract all <td> text values after a section header
  var idx = html.search(new RegExp(sectionLabel, 'i'));
  if (idx < 0) return [];
  var chunk = html.slice(idx, idx + 8000);
  var vals  = [];
  var re    = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  var m;
  while ((m = re.exec(chunk)) !== null) {
    var v = stripTags(m[1]);
    if (v) vals.push(v);
  }
  return vals;
}

function parseContratoInfo(html) {
  // ── Dados Gerais ────────────────────────────────────────────────────────────
  var codigo      = extractAfterColon(html, 'C.digo Contrato')   || extractAfterColon(html, 'Código Contrato')  || '—';
  var ade         = extractAfterColon(html, 'ADE')               || '—';
  var responsavel = extractAfterColon(html, 'Respons.vel')        || extractAfterColon(html, 'Responsável')       || '—';
  var banco       = extractAfterColon(html, 'Banco\\/Conv.nio')   || extractAfterColon(html, 'Banco')             || '—';
  var multiloja   = extractAfterColon(html, 'Multiloja')          || '—';
  var tipo        = extractAfterColon(html, 'Tipo de Opera..o')   || extractAfterColon(html, 'Tipo de Operação')  || '—';
  var digitacao   = extractAfterColon(html, 'Data Digita..o Banco')|| extractAfterColon(html, 'Data Digitação Banco') || '—';
  var rateio      = extractAfterColon(html, 'Rateio')             || null;
  var comercial   = extractAfterColon(html, 'Comercial')          || '—';
  var regional    = extractAfterColon(html, 'Regional')           || '—';

  // ── Dados Tabela ────────────────────────────────────────────────────────────
  var nomeTabela  = extractAfterColon(html, 'Nome Tabela')        || '—';
  var idTabela    = extractAfterColon(html, 'Id da tabela\\/prazo')|| extractAfterColon(html, 'Id da tabela') || '—';

  // ── Situação Financeiro ─────────────────────────────────────────────────────
  var situacao    = extractAfterColon(html, 'Situa..o Financeiro') || extractAfterColon(html, 'Situação Financeiro') || '—';

  // ── Linhas de comissão importadas ───────────────────────────────────────────
  var linhas = [];
  var linhasVals = parseTdValues(html, 'Linhas de comiss');
  // Header has: Valor Base | Valor Base Bruto | Comissão Recebida | Adiantamento Recebido | Importado por | Observações | Data Importação | Status
  // Data starts after 8 header cells
  if (linhasVals.length > 8) {
    var d = linhasVals.slice(8, 16);
    linhas.push({
      valorBase:         d[0] || '—',
      valorBaseBruto:    d[1] || '—',
      comissaoRecebida:  d[2] || '—',
      adiantamentoPct:   d[3] || '—',
      importadoPor:      d[4] || '—',
      observacoes:       d[5] || '',
      dataImportacao:    d[6] || '—',
      status:            d[7] || '—'
    });
  }

  // ── Comissão paga ───────────────────────────────────────────────────────────
  var comissaoPaga = null;
  var cpVals = parseTdValues(html, 'Comiss.o paga');
  // Header: Data Pagamento | Valor Base | Valor Base Bruto | Comissão Repassada | Valor Comissão | Adiantamento Repassado | Valor Adiantamento | Total % Repassado | Comissão Filiado | Comissão Master | Valor Total
  // 11 header cols → data starts at index 11
  if (cpVals.length > 11) {
    var r = cpVals.slice(11, 22);
    comissaoPaga = {
      dataPagamento:       r[0]  || '—',
      valorBase:           r[1]  || '—',
      valorBaseBruto:      r[2]  || '—',
      comissaoRepassadaPct:r[3]  || '—',
      valorComissao:       r[4]  || '—',
      adiantamentoPct:     r[5]  || '—',
      valorAdiantamento:   r[6]  || '—',
      totalPctRepassado:   r[7]  || '—',
      valorFiliado:        r[8]  || null,
      valorMaster:         r[9]  || null,
      valorTotal:          r[10] || '—'
    };
  }

  // ── Dados Operacional ───────────────────────────────────────────────────────
  var contratoPendente = extractAfterColon(html, 'Contrato Pendente')   || '—';
  var situacaoContrato = extractAfterColon(html, 'Situa..o Contrato')   || extractAfterColon(html, 'Situação Contrato') || '—';
  var dataPgtoCliente  = extractAfterColon(html, 'Data Pgto Cliente')   || '—';
  var historicoSit     = extractAfterColon(html, 'Hist.rico Situa..o')  || extractAfterColon(html, 'Histórico Situação') || '—';

  // Master info from multiloja field
  var masterNome = null;
  var mMatch = multiloja.match(/Master\s*[:\-]?\s*\d+\s*-\s*(.+)/i);
  if (mMatch) masterNome = mMatch[1].trim();

  return {
    fonte:              'web',
    codigo:             codigo,
    ade:                ade,
    responsavel:        responsavel,
    banco:              banco,
    tipo:               tipo,
    digitacao:          digitacao,
    comercial:          comercial,
    regional:           regional,
    multiloja:          multiloja,
    masterNome:         masterNome,
    rateio:             rateio,
    nomeTabela:         nomeTabela,
    idTabela:           idTabela,
    situacaoFinanceiro: situacao,
    linhasComissao:     linhas,
    comissaoPaga:       comissaoPaga,
    dadosOperacional: {
      contratoPendente: contratoPendente,
      situacaoContrato: situacaoContrato,
      dataPgtoCliente:  dataPgtoCliente,
      historicoSituacao:historicoSit
    }
  };
}

// ── OpenAPI fallback ──────────────────────────────────────────────────────────
async function getApiToken() {
  var now = Date.now();
  if (_apiToken && now < _apiTokenExp) return _apiToken;
  var body = 'grant_type=password&username=' + encodeURIComponent(API_USER)
    + '&password=' + encodeURIComponent(API_PASS)
    + '&client_id=' + encodeURIComponent(API_CLIENT_ID);
  var res = await httpReq({
    hostname: API_HOST, path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  var d = JSON.parse(res.body);
  if (!d.access_token) throw new Error('API auth failed');
  _apiToken    = d.access_token;
  _apiTokenExp = now + ((d.expires_in || 3600) * 1000 - 60000);
  return _apiToken;
}

function fmtDate(s) {
  if (!s) return null;
  var d = s.split('T')[0].split('-');
  return d.length === 3 ? d[2] + '/' + d[1] + '/' + d[0] : null;
}
function fmtBRL(n) {
  if (!n && n !== 0) return '—';
  return 'R$ ' + Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function normalizeApiContrato(c) {
  var cor  = c.corretor || {};
  var sala = cor.loja_sala || {};
  var com  = sala.responsavel || {};
  var reg  = sala.regional || {};
  var tcc  = c.tabela_coeficiente_comissao || {};

  var sf = 'AGUARDANDO IMPORTAÇÃO (RELATÓRIO BANCO)';
  if (!cor.usuario) sf = 'DADOS IMPORTADOS — USUÁRIO NÃO VINCULADO';
  else if (tcc.id && c.data_pgto_bc) sf = 'COMISSÃO PAGA AO CORRETOR';
  else if (tcc.id) sf = 'COMISSÃO DISPONÍVEL PARA PAGAMENTO';

  var vb  = c.valor_bruto || 0;
  var pct = parseFloat(tcc.comissao_recebida) || 0;
  var repPct = parseFloat(tcc.comissao_repassada) || 0;

  var comissaoPaga = null;
  if (sf.includes('PAGA AO CORRETOR')) {
    comissaoPaga = {
      dataPagamento:        fmtDate(c.data_pgto_bc) || '—',
      valorBase:            fmtBRL(vb),
      valorBaseBruto:       '—',
      comissaoRepassadaPct: repPct.toFixed(2) + ' %',
      valorComissao:        fmtBRL(vb * repPct / 100),
      adiantamentoPct:      '—',
      valorAdiantamento:    '—',
      totalPctRepassado:    '—',
      valorFiliado:         null,
      valorMaster:          null,
      valorTotal:           fmtBRL(vb * repPct / 100)
    };
  }

  return {
    fonte:              'api',
    codigo:             c.codigo || '—',
    ade:                c.ade    || '—',
    responsavel:        cor.usuario && cor.nome ? cor.usuario + ' - ' + cor.nome : '—',
    banco:              (c.banco && c.banco.nome) || '—',
    tipo:               (c.operacao && c.operacao.nome) || '—',
    digitacao:          fmtDate(c.data_pgto_bc) || '—',
    comercial:          com.usuario && com.nome ? com.usuario + ' - ' + com.nome : (cor.usuario && cor.nome ? cor.usuario + ' - ' + cor.nome : '—'),
    regional:           reg.usuario && reg.nome ? reg.usuario + ' - ' + reg.nome : '—',
    multiloja:          cor.corretor_multilojas ? 'Sim' : 'Não',
    masterNome:         sala.nome ? sala.nome.split(' - ').slice(1).join(' - ') : null,
    rateio:             null,
    nomeTabela:         (tcc.orgao_tabela && tcc.orgao_tabela.nome_tabela) || '—',
    idTabela:           tcc.id ? 'P.' + tcc.id : '—',
    situacaoFinanceiro: sf,
    linhasComissao:     tcc.id ? [{
      valorBase: fmtBRL(vb), valorBaseBruto: '—',
      comissaoRecebida: pct.toFixed(2) + ' %', adiantamentoPct: '—',
      importadoPor: '—', observacoes: '', dataImportacao: fmtDate(c.data_pgto_bc) || '—', status: 'Analisada'
    }] : [],
    comissaoPaga:       comissaoPaga,
    dadosOperacional: {
      contratoPendente: '—',
      situacaoContrato: (c.status_contrato && c.status_contrato.nome) || '—',
      dataPgtoCliente:  fmtDate(c.data_pgto_bc) || '—',
      historicoSituacao:'—'
    }
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async function(event) {
  var cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json; charset=utf-8'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  try {
    var body = JSON.parse(event.body || '{}');
    var ade  = (body.ade || '').trim();
    if (!ade) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'ade obrigatorio' }) };

    // ── Tenta web system primeiro ───────────────────────────────────────────
    try {
      var cookie = await getWebCookie();
      var res    = await httpReq({
        hostname: NOVA_HOST,
        path:     '/E2D/ContratoInfo/visualizar&cod=' + encodeURIComponent(ade),
        method:   'GET',
        headers:  { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' }
      });

      // Se redirecionou para login, sessão inválida
      if (res.status === 302 || res.body.includes('form_login') || res.body.includes('mfaLogin')) {
        _cookie = null; // força novo login
        throw new Error('SESSION_EXPIRED');
      }

      var contrato = parseContratoInfo(res.body);
      if (!contrato.ade || contrato.ade === '—') throw new Error('PARSE_FAILED');

      return { statusCode: 200, headers: cors, body: JSON.stringify([contrato]) };
    } catch(webErr) {
      // MFA ativo ou sessão inválida → fallback para OpenAPI
      if (!webErr.message.includes('MFA_REQUIRED') &&
          !webErr.message.includes('LOGIN_FAILED') &&
          !webErr.message.includes('SESSION_EXPIRED') &&
          !webErr.message.includes('PARSE_FAILED')) {
        throw webErr; // erro inesperado → propaga
      }

      // Fallback OpenAPI
      var token  = await getApiToken();
      var apiRes = await httpReq({
        hostname: API_HOST,
        path:     '/contratos?ade=' + encodeURIComponent(ade),
        method:   'GET',
        headers:  { 'Authorization': 'Bearer ' + token }
      });
      var raw   = JSON.parse(apiRes.body);
      var items = (raw && raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
      var contratos = items.map(normalizeApiContrato);
      return { statusCode: 200, headers: cors, body: JSON.stringify(contratos) };
    }

  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
