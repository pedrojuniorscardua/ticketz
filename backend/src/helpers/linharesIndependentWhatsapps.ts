import Whatsapp from "../models/Whatsapp";
import { GetCompanySetting } from "./CheckSettings";

/**
 * Linhares: "conexão independente" — número cujas conversas não se misturam
 * com as dos outros números (ex.: FIXOLOJA, do financeiro, que manda cobrança).
 * Efeitos: (1) nela a etiqueta Carteira é ignorada e o "último atendente" só
 * olha tickets dela mesma; (2) nas outras conexões o "último atendente" ignora
 * os tickets dela; (3) "nova conversa" não é bloqueada por ticket aberto dela,
 * nem ela bloqueia as outras.
 * Setting linharesIndependentWhatsapps: nomes das conexões separados por
 * vírgula (sem diferenciar maiúsculas). Vazio = nenhuma.
 */
export const getIndependentWhatsappIds = async (
  companyId: number
): Promise<number[]> => {
  const raw = await GetCompanySetting(
    companyId,
    "linharesIndependentWhatsapps",
    ""
  );
  const names = (raw || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (!names.length) return [];

  const rows = await Whatsapp.findAll({
    where: { companyId },
    attributes: ["id", "name"]
  });
  return rows
    .filter(w => names.includes((w.name || "").trim().toLowerCase()))
    .map(w => w.id);
};

export default getIndependentWhatsappIds;
