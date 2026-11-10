import { getIO } from "../libs/socket";
import Message from "../models/Message";
import { logger } from "../utils/logger";
import { LOCAL_TRANSCRIBER_PROVIDER, transcriber } from "./transcriber";

/**
 * Linhares: transcrição de áudio pelo Whisper local (provedor "local" em
 * Configurações → Serviço de IA; container "whisper" da stack).
 *
 * Diferente dos provedores de nuvem, que respondem em 1–2 s e por isso são
 * chamados antes de gravar a mensagem, o Whisper em CPU pode levar dezenas de
 * segundos num áudio longo. Aqui a mensagem é gravada e exibida na hora; a
 * transcrição roda depois, em fila (um áudio por vez, para não disputar CPU e
 * memória com o atendimento), e o texto chega à conversa aberta pelo evento
 * "update" da mensagem.
 *
 * Falha (container parado, áudio ilegível) só gera log: a mensagem fica como
 * áudio comum. A fila vive na memória — áudio pendente num restart do backend
 * fica sem texto.
 */

type TranscriptionJob = {
  messageId: string;
  ticketId: number;
  companyId: number;
  audioPath: string;
  filename?: string;
};

const MAX_PENDING_JOBS = 50;

let pendingJobs = 0;
let queueTail: Promise<void> = Promise.resolve();

const runJob = async (job: TranscriptionJob): Promise<void> => {
  const startedAt = Date.now();

  const text = await transcriber(
    job.audioPath,
    { apiKey: null, provider: LOCAL_TRANSCRIBER_PROVIDER },
    job.filename
  );

  const body = text?.trim();
  if (!body) {
    logger.info(
      { messageId: job.messageId, ticketId: job.ticketId },
      "linhares transcricao local: sem texto"
    );
    return;
  }

  const message = await Message.findOne({
    where: { id: job.messageId, ticketId: job.ticketId },
    include: [
      "contact",
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"],
        where: { companyId: job.companyId },
        required: false
      }
    ]
  });

  // apagada pelo cliente enquanto a transcricao rodava
  if (!message || message.isDeleted) {
    return;
  }

  await message.update({ body });

  getIO()
    .to(job.ticketId.toString())
    .emit(`company-${job.companyId}-appMessage`, {
      action: "update",
      message
    });

  logger.info(
    {
      messageId: job.messageId,
      ticketId: job.ticketId,
      ms: Date.now() - startedAt,
      chars: body.length
    },
    "linhares transcricao local: concluida"
  );
};

export const queueLocalTranscription = (job: TranscriptionJob): void => {
  if (pendingJobs >= MAX_PENDING_JOBS) {
    logger.warn(
      { messageId: job.messageId, pendingJobs },
      "linhares transcricao local: fila cheia, audio fica sem texto"
    );
    return;
  }

  pendingJobs += 1;
  queueTail = queueTail
    .then(() => runJob(job))
    .catch(error => {
      logger.error(
        { messageId: job.messageId, error: error?.message },
        "linhares transcricao local: falhou"
      );
    })
    .finally(() => {
      pendingJobs -= 1;
    });
};
