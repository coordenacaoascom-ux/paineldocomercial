const https = require('https');

const STORM_USER = '3504';
const STORM_PASS = 'Promotoraaaa@@2405';
const STORM_CLIENT_ID = 'KxF2YZGcLTjk3WpaxEE7';
const STORM_HOST = 'openapi.stormfin.com.br';

var _stormToken = null;
var _stormTokenExp = 0;

function httpReq(options, body) {
  return new Promise(function(resolve, reject) {
    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  var now = Date.now();
  if (_stormToken && now < _stormTokenExp) return _stormToken;
  var body = 'grant_type=password'
    + '&username=' + encodeURIComponent(STORM_USER)
    + '&password=' + encodeURIComponent(STORM_PASS)
    + '&client_id=' + encodeURIComponent(STORM_CLIENT_ID);
  var res = await httpReq({
    hostname: STORM_HOST, path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!res.data || !res.data.access_token) throw new Error('Storm auth failed: ' + JSON.stringify(res.data));
  _stormToken = res.data.access_token;
  _stormTokenExp = now + ((res.data.expires_in || 3600) * 1000 - 60000);
  return _stormToken;
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

function deriveSituacao(c) {
  var tcc = c.tabela_coeficiente_comissao;
  var cor = c.corretor;
  var statusNome = (c.status_contrato && c.status_contrato.nome) || '';

  // Sem corretor vinculado
  if (!cor || !cor.usuario) return 'DADOS IMPORTADOS — USUÁRIO NÃO VINCULADO';

  // Tomada de decisão
  if (/TOMAD/i.test(statusNome)) return 'CONTRATO EM TOMADA DE DECISÃO';

  // Sem tabela de comissão
  if (!tcc) {
    if (!c.data_pgto_bc) return 'AGUARDANDO IMPORTAÇÃO (RELATÓRIO BANCO)';
    return 'DADOS IMPORTADOS';
  }

  // Tem tabela + data de pgto banco → comissão importada e paga ao corretor
  if (c.data_pgto_bc) return 'COMISSÃO PAGA AO CORRETOR';

  // Tem tabela mas sem data pgto → disponível para pagamento
  return 'COMISSÃO DISPONÍVEL PARA PAGAMENTO';
}

function buildLinhas(c) {
  var tcc = c.tabela_coeficiente_comissao;
  if (!tcc) return [];
  var vb = c.valor_bruto || 0;
  var comissao_pct = parseFloat(tcc.comissao_recebida) || 0;
  var comissao_val = vb * comissao_pct / 100;
  var adiantamento_pct = parseFloat(tcc.comissao_recebida_adiantamento) || 0;
  var adiantamento_val = vb * adiantamento_pct / 100;
  return [{
    valorBase: fmtBRL(vb),
    valorBaseBruto: '—',
    comissaoRecebida: comissao_pct.toFixed(2) + '%',
    comissaoValor: fmtBRL(comissao_val),
    adiantamento: adiantamento_pct > 0 ? fmtBRL(adiantamento_val) : '—',
    adiantamentoPct: adiantamento_pct > 0 ? adiantamento_pct.toFixed(2) + '%' : '—',
    importadoPor: '—',
    observacoes: '',
    dataImportacao: fmtDate(c.data_pgto_bc) || '—',
    status: 'Analisada'
  }];
}

function normalizeContrato(c) {
  var cor = c.corretor || {};
  var sala = cor.loja_sala || {};
  var comercialInfo = sala.responsavel || {};
  var regionalInfo = sala.regional || {};

  var comercialStr = '—';
  if (comercialInfo.usuario && comercialInfo.nome) comercialStr = comercialInfo.usuario + ' - ' + comercialInfo.nome;
  else if (cor.usuario && cor.nome) comercialStr = cor.usuario + ' - ' + cor.nome;

  var regionalStr = '—';
  if (regionalInfo.usuario && regionalInfo.nome) regionalStr = regionalInfo.usuario + ' - ' + regionalInfo.nome;

  var responsavelStr = '—';
  if (cor.usuario && cor.nome) responsavelStr = cor.usuario + ' - ' + cor.nome;

  var tcc = c.tabela_coeficiente_comissao || {};
  var sf = deriveSituacao(c);
  var linhas = buildLinhas(c);
  var vb = c.valor_bruto || 0;
  var pct = parseFloat(tcc.comissao_recebida) || 0;
  var comissaoVal = vb * pct / 100;

  var comissaoPaga = null;
  if (sf.includes('PAGA AO CORRETOR')) {
    comissaoPaga = {
      dataPagamento: fmtDate(c.data_pgto_bc) || '—',
      valorBase: fmtBRL(vb),
      valorComissao: fmtBRL(comissaoVal),
      totalPercentual: pct.toFixed(2) + '%',
      valorTotal: fmtBRL(comissaoVal)
    };
  }

  return {
    codigo: c.codigo || '—',
    ade: c.ade || '—',
    responsavel: responsavelStr,
    banco: (c.banco && c.banco.nome) || '—',
    tipo: (c.operacao && c.operacao.nome) || '—',
    digitacao: fmtDate(c.data_pgto_bc) || '—',
    comercial: comercialStr,
    regional: regionalStr,
    multiloja: cor.corretor_multilojas ? 'Sim' : 'Não',
    nomeTabela: (tcc.orgao_tabela && tcc.orgao_tabela.nome_tabela) || '—',
    idTabela: tcc.id ? 'P.' + tcc.id : '—',
    situacaoFinanceiro: sf,
    linhasComissao: linhas,
    comissaoPaga: comissaoPaga,
    dataPagamento: fmtDate(c.data_pgto_bc),
    dadosOperacional: {
      contratoPendente: '—',
      situacaoContrato: (c.status_contrato && c.status_contrato.nome) || '—',
      dataPgtoCliente: fmtDate(c.data_pgto_bc) || '',
      historicoSituacao: '—',
      historicoTrocaAde: '—',
      historicoPendencia: '—'
    }
  };
}

exports.handler = async function(event) {
  var cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  try {
    var body = JSON.parse(event.body || '{}');
    var ade = body.ade;
    if (!ade) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'ade obrigatorio' }) };

    var token = await getToken();
    var res = await httpReq({
      hostname: STORM_HOST,
      path: '/contratos?ade=' + encodeURIComponent(ade),
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    });

    var raw = res.data;
    var items = (raw && raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
    var contratos = items.map(normalizeContrato);

    return { statusCode: 200, headers: cors, body: JSON.stringify(contratos) };
  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
