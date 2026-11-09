import { QueryTypes } from "sequelize";
import sequelize from "../database";
import { logger } from "../utils/logger";

/**
 * Linhares: "sonda" do monitor de conexões (ticketz-local\monitor-conexoes.ps1
 * no servidor). De tempos em tempos o monitor manda, pela API do Ticketz, uma
 * mensagem de um número da casa para outro e confere se ela ENTROU no Ticketz
 * — é o único jeito de perceber uma conexão que segue "CONNECTED" e enviando,
 * mas parou de receber (caso do CELULARLME em 09/11/2026, 14:56–16:41).
 *
 * A sonda nunca vira contato, ticket nem mensagem: o listener reconhece o
 * texto, grava a chegada na tabela própria linhares_sonda (fora do schema do
 * Ticketz; criada pelo instalador do monitor) e para ali. Sem a tabela, a
 * sonda é só descartada.
 *
 * Formato: U+200E U+2063 "sonda-linhares:" + identificador (8 a 64 caracteres
 * [A-Za-z0-9-]). O U+200E inicial também faz o lado que ENVIA ignorar a
 * própria mensagem (regra do upstream para mensagens fromMe).
 */
const PROBE_PATTERN = /^‎⁣sonda-linhares:([A-Za-z0-9-]{8,64})\s*$/;

export const getLinharesProbeId = (body?: string | null): string | null => {
  if (!body) return null;
  const match = PROBE_PATTERN.exec(body);
  return match ? match[1] : null;
};

export const registerLinharesProbe = async (
  whatsappId: number,
  probeId: string,
  sender: string | null
): Promise<void> => {
  try {
    await sequelize.query(
      `INSERT INTO linhares_sonda ("whatsappId", sonda, remetente, "recebidaEm")
       VALUES (:whatsappId, :probeId, :sender, now())`,
      {
        replacements: { whatsappId, probeId, sender },
        type: QueryTypes.INSERT
      }
    );
    logger.info({ whatsappId, probeId }, "linhares sonda recebida");
  } catch (error) {
    logger.warn(
      { whatsappId, probeId, error: error?.message },
      "linhares sonda: nao consegui gravar (tabela linhares_sonda existe?)"
    );
  }
};
