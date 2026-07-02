import { publicBaseUrl } from './http.js';

export function brDate(date) {
  if (!date) return '';
  const [y, m, d] = String(date).split('-');
  return `${d}/${m}/${y}`;
}

export function brMoney(cents) {
  const value = Number(cents || 0) / 100;
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

function observacaoLine(observacao) {
  const text = String(observacao || '').trim();
  return text ? `\n• Observação: ${text}` : '';
}

function detalhesServico({ barbeiro_nome, servico_preco_cents }) {
  return `\n• Barbeiro: *${barbeiro_nome || 'Qualquer profissional'}*\n• Valor: *${brMoney(servico_preco_cents)}*`;
}

export function msgClienteRecebido({ barbearia, cliente_nome, servico_nome, barbeiro_nome, servico_preco_cents, data_agendamento, hora_inicio, agendamento_id, observacao }) {
  const link = `${publicBaseUrl()}/api/confirmar?id=${agendamento_id}`;
  return `✅ *Agendamento recebido*\n\nOlá, *${cliente_nome}*.\nSeu horário foi solicitado na *${barbearia.nome}*.\n\n• Serviço: *${servico_nome}*${detalhesServico({ barbeiro_nome, servico_preco_cents })}\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*${observacaoLine(observacao)}\n\nAguarde a confirmação da barbearia.\n\nLink do agendamento:\n${link}`;
}

export function msgDonoNovo({ barbearia, cliente_nome, cliente_whatsapp, servico_nome, barbeiro_nome, servico_preco_cents, data_agendamento, hora_inicio, observacao }) {
  const painel = `${publicBaseUrl()}/painel`;
  return `📅 *Novo agendamento - ${barbearia.nome}*\n\n• Cliente: *${cliente_nome}*\n• WhatsApp: ${cliente_whatsapp}\n• Serviço: *${servico_nome}*${detalhesServico({ barbeiro_nome, servico_preco_cents })}\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*${observacaoLine(observacao)}\n\nAbra o painel para acompanhar:\n${painel}`;
}

export function msgClienteConfirmado({ barbearia, cliente_nome, servico_nome, barbeiro_nome, servico_preco_cents, data_agendamento, hora_inicio, observacao }) {
  return `✅ *Horário confirmado!*\n\nOlá, *${cliente_nome}*.\nSeu agendamento na *${barbearia.nome}* foi confirmado.\n\n• Serviço: *${servico_nome}*${detalhesServico({ barbeiro_nome, servico_preco_cents })}\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*${observacaoLine(observacao)}\n\nChegue com alguns minutos de antecedência. 💈`;
}

export function msgClienteLembrete({ barbearia, cliente_nome, servico_nome, barbeiro_nome, servico_preco_cents, data_agendamento, hora_inicio, observacao }) {
  return `⏰ *Lembrete do seu horário*\n\nOlá, *${cliente_nome}*.\nFaltam cerca de *30 minutos* para seu atendimento na *${barbearia.nome}*.\n\n• Serviço: *${servico_nome}*${detalhesServico({ barbeiro_nome, servico_preco_cents })}\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*${observacaoLine(observacao)}\n\nResponda com:\n*1* - Confirmar presença\n*2* - Cancelar horário`;
}

export function msgDonoClienteConfirmou({ cliente_nome, servico_nome, barbeiro_nome, servico_preco_cents, data_agendamento, hora_inicio, observacao }) {
  return `✅ *Cliente confirmou presença*\n\n• Cliente: *${cliente_nome}*\n• Serviço: *${servico_nome}*${detalhesServico({ barbeiro_nome, servico_preco_cents })}\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*${observacaoLine(observacao)}`;
}

export function msgDonoClienteCancelou({ cliente_nome, servico_nome, barbeiro_nome, servico_preco_cents, data_agendamento, hora_inicio, observacao }) {
  return `❌ *Cliente cancelou o horário*\n\n• Cliente: *${cliente_nome}*\n• Serviço: *${servico_nome}*${detalhesServico({ barbeiro_nome, servico_preco_cents })}\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*${observacaoLine(observacao)}`;
}

export function msgClientePresencaConfirmada({ barbearia, cliente_nome, servico_nome, barbeiro_nome, servico_preco_cents, data_agendamento, hora_inicio, observacao }) {
  return `✅ *Presença confirmada*\n\nObrigado, *${cliente_nome}*.\nConfirmamos sua presença na *${barbearia.nome}*.\n\n• Serviço: *${servico_nome}*${detalhesServico({ barbeiro_nome, servico_preco_cents })}\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*${observacaoLine(observacao)}\n\nEsperamos você! 💈`;
}

export function msgClienteCancelamentoConfirmado({ barbearia, cliente_nome, servico_nome, barbeiro_nome, servico_preco_cents, data_agendamento, hora_inicio, observacao }) {
  return `❌ *Horário cancelado*\n\nPronto, *${cliente_nome}*.\nSeu agendamento na *${barbearia.nome}* foi cancelado.\n\n• Serviço: *${servico_nome}*${detalhesServico({ barbeiro_nome, servico_preco_cents })}\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*${observacaoLine(observacao)}`;
}
