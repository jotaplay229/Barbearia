import { publicBaseUrl } from './http.js';

export function brDate(date) {
  if (!date) return '';
  const [y, m, d] = String(date).split('-');
  return `${d}/${m}/${y}`;
}

export function msgClienteRecebido({ barbearia, cliente_nome, servico_nome, barbeiro_nome, data_agendamento, hora_inicio, agendamento_id }) {
  const link = `${publicBaseUrl()}/api/confirmar?id=${agendamento_id}`;
  return `✅ *Agendamento recebido*\n\nOlá, *${cliente_nome}*.\nSeu horário foi solicitado na *${barbearia.nome}*.\n\n• Serviço: *${servico_nome}*\n• Barbeiro: *${barbeiro_nome || 'Qualquer profissional'}*\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*\n\nAguarde a confirmação da barbearia.\n\nLink do agendamento:\n${link}`;
}

export function msgDonoNovo({ barbearia, cliente_nome, cliente_whatsapp, servico_nome, barbeiro_nome, data_agendamento, hora_inicio }) {
  const painel = `${publicBaseUrl()}/painel`;
  return `📅 *Novo agendamento - ${barbearia.nome}*\n\n• Cliente: *${cliente_nome}*\n• WhatsApp: ${cliente_whatsapp}\n• Serviço: *${servico_nome}*\n• Barbeiro: *${barbeiro_nome || 'Qualquer profissional'}*\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*\n\nAbra o painel para acompanhar:\n${painel}`;
}

export function msgClienteConfirmado({ barbearia, cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `✅ *Horário confirmado!*\n\nOlá, *${cliente_nome}*.\nSeu agendamento na *${barbearia.nome}* foi confirmado.\n\n• Serviço: *${servico_nome}*\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*\n\nChegue com alguns minutos de antecedência. 💈`;
}

export function msgClienteLembrete({ barbearia, cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `⏰ *Lembrete do seu horário*\n\nOlá, *${cliente_nome}*.\nFaltam cerca de *30 minutos* para seu atendimento na *${barbearia.nome}*.\n\n• Serviço: *${servico_nome}*\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*\n\nResponda com:\n*1* - Confirmar presença\n*2* - Cancelar horário`;
}

export function msgDonoClienteConfirmou({ cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `✅ *Cliente confirmou presença*\n\n• Cliente: *${cliente_nome}*\n• Serviço: *${servico_nome}*\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*`;
}

export function msgDonoClienteCancelou({ cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `❌ *Cliente cancelou o horário*\n\n• Cliente: *${cliente_nome}*\n• Serviço: *${servico_nome}*\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*`;
}

export function msgClientePresencaConfirmada({ barbearia, cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `✅ *Presença confirmada*\n\nObrigado, *${cliente_nome}*.\nConfirmamos sua presença na *${barbearia.nome}*.\n\n• Serviço: *${servico_nome}*\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*\n\nEsperamos você! 💈`;
}

export function msgClienteCancelamentoConfirmado({ barbearia, cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `❌ *Horário cancelado*\n\nPronto, *${cliente_nome}*.\nSeu agendamento na *${barbearia.nome}* foi cancelado.\n\n• Serviço: *${servico_nome}*\n• Data: *${brDate(data_agendamento)}*\n• Horário: *${hora_inicio}*`;
}
